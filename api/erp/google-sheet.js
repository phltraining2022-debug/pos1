const fs = require('fs');
const { google } = require('googleapis');

// Load client secrets from a local file.
const credentials = JSON.parse(fs.readFileSync('google-sheet-credentials.json', 'utf8'));

const { client_email, private_key } = credentials;

// Create an OAuth2 client with the given credentials
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: client_email,
    private_key: private_key,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Function to read data from Google Sheet
async function readSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = '1Km_tSGmF-xAcSr98fEEZYIGG-8muPiZtjUEviRha6A0'; // Spreadsheet ID from the provided URL
  const range = 'Sheet1!A1:E'; // Replace with the desired range

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = res.data.values;
    if (rows.length) {
      console.log('Data from the sheet:');
      rows.map((row) => {
        console.log(`${row.join(', ')}`);
      });
    } else {
      console.log('No data found.');
    }
  } catch (err) {
    console.error('The API returned an error:', err);
  }
}

// Function to write data to Google Sheet
async function writeSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = '1Km_tSGmF-xAcSr98fEEZYIGG-8muPiZtjUEviRha6A0'; // Spreadsheet ID from the provided URL
  const range = 'Sheet1!A1'; // Replace with the desired range
  const valueInputOption = 'RAW'; // RAW or USER_ENTERED

  const values = [
    ['Item', 'Cost', 'Stock'],
    ['Pen', '$1.00', '100'],
    ['Notebook', '$2.00', '200'],
  ];

  const resource = {
    values,
  };

  try {
    const result = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption,
      resource,
    });
    console.log(`${result.data.updatedCells} cells updated.`);
  } catch (err) {
    console.error('The API returned an error:', err);
  }
}

// Execute the functions
// readSheet();
// writeSheet();

