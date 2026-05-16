const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const app = require('../server');
const Lead = app.models.Lead;

const STATE_FILE = path.resolve(__dirname, 'sync-state.json');
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const FACEBOOK_FORM_ID = process.env.FACEBOOK_FORM_ID || '2088948741594851';
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || 'EAAPPyU87YncBPJt7eZAqn1tCrfwbwMcno0M1Tf3D5l6oGwAkmdbOgjBAHmBO9z6OKwUGVy5i4kLPU3ZBOgl9hWaP3fsNDjzQm5k1kDGGr6BBPpF53OC5rZAVppx1A3fWF5jdAQ8nP3s4O3frA3hrujBBbNfsI9ORNZBEg2BLlbwCZBJYUZCw3R7zYmaJHhT6yHyx2Aj2Qx3iIZCgJ0E';

if (!FACEBOOK_FORM_ID || !FACEBOOK_PAGE_ACCESS_TOKEN) {
  throw new Error('Missing FACEBOOK_FORM_ID or FACEBOOK_PAGE_ACCESS_TOKEN in environment variables.');
}

// --- State Management ---
const getLastRunTimestamp = async () => {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    const { lastRunTimestamp } = JSON.parse(data);
    return lastRunTimestamp || (Date.now() - TWO_YEARS_MS) / 1000;
  } catch {
    return (Date.now() - TWO_YEARS_MS) / 1000;
  }
};

const setLastRunTimestamp = async (timestamp) => {
  await fs.writeFile(STATE_FILE, JSON.stringify({ lastRunTimestamp: timestamp }), 'utf8');
};

// --- Facebook API Fetching ---
const fetchFacebookLeads = async (since) => {
  let leads = [];
  let url = `https://graph.facebook.com/v18.0/${FACEBOOK_FORM_ID}/leads?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}&since=${since}`;
  let maxCreatedTime = since;

  while (url) {
    try {
      const res = await axios.get(url);
      if (res.data && res.data.data) {
        leads = leads.concat(res.data.data);
        for (const lead of res.data.data) {
          const createdTime = Math.floor(new Date(lead.created_time).getTime() / 1000);
          if (createdTime > maxCreatedTime) maxCreatedTime = createdTime;
        }
      }
      url = res.data.paging && res.data.paging.next ? res.data.paging.next : null;
    } catch (err) {
      console.error('Error fetching leads from Facebook:', err.message);
      break;
    }
  }

  return { leads, maxCreatedTime };
};

// --- Data Transformation (async, mapping Level/Branch) ---
const transformFacebookLead = async (fbLead, app) => {
  const Level = app.models.Level;
  const Branch = app.models.Branch;

  const fieldMap = {};
  (fbLead.field_data || []).forEach(field => {
    fieldMap[field.name] = field.values[0];
  });

  const fullName = fieldMap['full_name'] || '';
  const [givenName, ...rest] = fullName.split(' ');
  const familyName = rest.join(' ');

  let phone = fieldMap['phone_number'] || '';
  if (phone && !phone.startsWith('0')) {
    phone = '0' + phone.replace(/^(\+84|84)/, '');
  }

  // Xử lý levelIds
  let levelIds;
  if (fieldMap['bậc_học_mà_bạn_quan_tâm?_(...)']) {
    const levelName = fieldMap['bậc_học_mà_bạn_quan_tâm?_(...)'].trim();
    const level = await Level.findOne({
      where: { name: { like: new RegExp(`^${levelName}$`, 'i') } }
    });
    if (level) levelIds = [level.id];
  }

  // Xử lý branchId
  let branchId;
  if (fieldMap['_bạn_muốn_tham_dự_sự_kiện_tại_đâu']) {
    const branchName = fieldMap['_bạn_muốn_tham_dự_sự_kiện_tại_đâu'].trim();
    const branch = await Branch.findOne({
      where: {
        or: [
          { name: { like: new RegExp(`^${branchName}$`, 'i') } },
          { code: { like: new RegExp(`^${branchName}$`, 'i') } },
          { shortName: { like: new RegExp(`^${branchName}$`, 'i') } }
        ]
      }
    });
    if (branch) branchId = branch.id;
  }

  // Build leadData
  const leadData = {
    name: fullName,
    givenName: givenName || '',
    familyName: familyName || '',
    email: fieldMap['email'] || '',
    phone,
    sourceOfLead: 'Facebook Chat',
    status: 'new',
    createdAt: new Date(),
    notes: [],
    externalSources: {
      facebook: {
        id: fbLead.id,
        createdAt: fbLead.created_time
      }
    }
  };
  if (levelIds) leadData.levelIds = levelIds;
  if (branchId) leadData.branchId = branchId;

  return leadData;
};

// --- Lead Processing ---
const findLeadByFacebookId = async (facebookId) => {
  return await Lead.findOne({ where: { 'externalSources.facebook.id': facebookId } });
};

const findDuplicateByContactInfo = async (email, phone) => {
  const twoYearsAgo = new Date(Date.now() - TWO_YEARS_MS);
  return await Lead.findOne({
    where: {
      or: [
        { email: email || null },
        { phone: phone || null }
      ],
      createdAt: { gt: twoYearsAgo }
    }
  });
};

const updateExistingLead = async (lead, fbLead) => {
  const externalSources = lead.externalSources || {};
  externalSources.facebook = {
    id: fbLead.id,
    createdAt: fbLead.created_time
  };
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  notes.push({
    date: new Date(),
    message: `Quan tâm mới từ Facebook lúc ${fbLead.created_time}`,
    source: 'Facebook'
  });
  await lead.updateAttributes({
    externalSources,
    notes
  });
};

const createNewLead = async (leadData) => {
  await Lead.create(leadData);
};

const processLead = async (fbLead) => {
  // Sử dụng transform async mới
  const leadData = await transformFacebookLead(fbLead, app);

  // 1. Check trùng Facebook
  const existingByFbId = await findLeadByFacebookId(fbLead.id);
  if (existingByFbId) return; // Đã có, bỏ qua

  // 2. Check trùng email/phone
  const duplicate = await findDuplicateByContactInfo(leadData.email, leadData.phone);

  // 3. Action
  if (duplicate) {
    await updateExistingLead(duplicate, fbLead);
  } else {
    await createNewLead(leadData);
  }
};

// --- Main Function ---
const syncLeads = async () => {
  const lastRunTimestamp = await getLastRunTimestamp();
  const { leads, maxCreatedTime } = await fetchFacebookLeads(lastRunTimestamp);

  for (const fbLead of leads) {
    try {
      await processLead(fbLead);
    } catch (err) {
      console.error(`Lỗi xử lý lead Facebook ${fbLead.id}:`, err.message);
    }
  }

  // Chỉ update lastRunTimestamp nếu có lead mới
  if (leads.length > 0) {
    await setLastRunTimestamp(maxCreatedTime);
  }
};

module.exports = { syncLeads };