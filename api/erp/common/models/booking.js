const { status } = require("loopback");
const LoopBackContext = require('loopback-context');


module.exports = function(Booking) {
    Booking.observe('before save', async function (ctx) {
        console.log('Checking for booking collisions...');

        const booking = ctx.instance;
        if (booking && booking.roomId && booking.date) {
            // date is start time, we need to prepare a few hours before start time (date)
            const startTime = new Date(booking.date);
            startTime.setHours(startTime.getHours() - 2); // prepare 2 hours before

            const endTime = new Date(booking.date);
            endTime.setHours(endTime.getHours() + 4); // prepare 2 hours after

            const overlappingBookings = await Booking.find({
            where: {
                roomId: booking.roomId,
                status: { nin: ['cancelled', 'overdue'] },
                and: [
                { date: { gt: startTime } },
                { date: { lt: endTime } }
                ]
            }
            });

            // If there is itself (in case of update), ignore it
            _overlappingBookings = overlappingBookings.filter(b => b.id == booking.id);


            if (!booking.id && overlappingBookings.length > 0) {
                console.log('Booking collision detected:', booking.id, overlappingBookings[0].id);
                const err = new Error('Booking collision: The room is already booked for the selected time range.');
                err.statusCode = 409; // Conflict
                throw err;
            } else {
                console.log('No booking collisions detected.');
            }
        } 
       
    });
    Booking.observe('before delete', async function (ctx) {
        let currentUserId = null;
    
        // 1. Nếu middleware đã set ctx.options.accessToken.userId thì ưu tiên dùng
        if (ctx.options && ctx.options.accessToken && ctx.options.accessToken.userId) {
          currentUserId = ctx.options.accessToken.userId;
        }
    
        // 2. Thử lấy từ LoopBackContext (nhiều chỗ trong code đang dùng kiểu này)
        if (!currentUserId) {
            const lbCtx = LoopBackContext.getCurrentContext();
            if (lbCtx && lbCtx.get) {
              const ctxUserId =
                lbCtx.get('currentUserId') ||
                (lbCtx.get('currentUser') && lbCtx.get('currentUser').id);
              if (ctxUserId) {
                currentUserId = ctxUserId;
              }
            }
          }
    
        // 3. Nếu vẫn chưa có, đọc Authorization header và tra model AccessToken
        if (!currentUserId) {
          const lbCtx = LoopBackContext.getCurrentContext();
          const req =
            (lbCtx && lbCtx.get && (lbCtx.get('httpRequest') || lbCtx.get('req')))
            || (ctx.options && ctx.options.req); // fallback nếu có
    
          const authHeader =
            req &&
            (req.headers && req.headers.authorization
              ? req.headers.authorization
              : req.get && req.get('Authorization'));
    
          if (authHeader) {
            const AccessToken = Booking.app.models.AccessToken;
            try {
              // Trong LoopBack, id của AccessToken chính là token string trong header
              const tokenInst = await AccessToken.findById(authHeader);
              if (tokenInst && tokenInst.userId) {
                currentUserId = tokenInst.userId;
              }
            } catch (e) {
              console.error('Lookup AccessToken failed:', e && e.message);
            }
          }
        }
    
        // 4. Nếu tới đây vẫn không lấy được userId → coi như chưa đăng nhập
        if (!currentUserId) {
          const err = new Error('Unauthorized: You must be logged in to delete a booking.');
          err.statusCode = 401;
          throw err;
        }
    
        // ===== phần dưới giữ nguyên code cũ của bạn =====
    
        const bookingId =
          (ctx.where && ctx.where.id) ||
          (ctx.instance && ctx.instance.id);
    
        if (!bookingId) {
          const err = new Error('Bad request: Missing booking id.');
          err.statusCode = 400;
          throw err;
        }
    
        const booking = await Booking.findById(bookingId);
        if (!booking) {
          const err = new Error('Booking not found.');
          err.statusCode = 404;
          throw err;
        }
    
        if (booking.createdById && String(booking.createdById) === String(currentUserId)) {
          console.log('Booking delete allowed: creator matches', currentUserId);
          return;
        }
    
        const Role = Booking.app.models.Role;
        const RoleMapping = Booking.app.models.RoleMapping;
    
        const adminRole = await Role.findOne({ where: { name: 'admin' } });
        if (!adminRole) {
          const err = new Error('Forbidden: Only admin or the creator can delete this booking.');
          err.statusCode = 403;
          throw err;
        }
    
        const adminMapping = await RoleMapping.findOne({
          where: {
            roleId: adminRole.id,
            principalId: String(currentUserId),
            principalType: 'USER'
          }
        });
    
        if (!adminMapping) {
          const err = new Error('Forbidden: Only admin or the creator can delete this booking.');
          err.statusCode = 403;
          throw err;
        }
    
        console.log('Booking delete allowed: user is admin', currentUserId);
    });

    Booking.observe('after save', async function (ctx) {
      // Nếu được đánh dấu là save do sync từ Contract thì bỏ qua, tránh vòng lặp
      if (ctx.options && ctx.options.skipSyncFromContractHook) {
        console.log('[Booking after save] Skipping because of skipSyncFromContractHook flag');
        return;
      }

      const booking = ctx.instance || ctx.data;
      if (!booking || !booking.id) {
        console.log('[Booking after save] No booking or booking.id');
        return;
      }

      console.log('[Booking after save] Booking ID:', booking.id, 'isNewInstance:', ctx.isNewInstance);

      if (!booking.leadId) {
        console.log('[Booking after save] No leadId, skipping');
        return;
      }

      const Transaction = Booking.app.models.Transaction;
      const Contract = Booking.app.models.Contract;
      const Lead = Booking.app.models.Lead;
      const Product = Booking.app.models.Product;
      const Employee = Booking.app.models.Employee;

      try {
          // Nếu là update booking và đã có contract, thì update contract
          if (!ctx.isNewInstance) {
              console.log('[Booking after save] This is an update, checking for existing contract...');
              
              // Load lại booking từ DB để có đầy đủ data
              const fullBooking = await Booking.findById(booking.id);
              if (!fullBooking) {
                  console.log('[Booking after save] Could not load full booking data');
                  return;
              }

              console.log('[Booking after save] Loaded full booking, leadId:', fullBooking.leadId, 'bookingId:', fullBooking.id);

              // Tìm contract theo bookingId - thử cả exact match và regex
              let existingContract = await Contract.findOne({
                  where: {
                      leadId: fullBooking.leadId,
                      bookingId: fullBooking.id
                  }
              });

              console.log('[Booking after save] Tried exact match, found:', existingContract ? existingContract.id : 'none');

              // Nếu không tìm thấy, thử với regex
              if (!existingContract) {
                  console.log('[Booking after save] Trying regex match...');
                  existingContract = await Contract.findOne({
                      where: {
                          leadId: fullBooking.leadId,
                          bookingId: {
                              regexp: String(fullBooking.id),
                              options: 'i'
                          }
                      }
                  });
                  console.log('[Booking after save] Tried regex match, found:', existingContract ? existingContract.id : 'none');
              }

              if (existingContract) {
                  console.log('[Booking after save] Found existing contract:', existingContract.id);
                  const updateData = {};
                  
                  // Sync các field từ booking sang contract
                  if (fullBooking.date !== undefined && fullBooking.date !== null) {
                      updateData.eventDate = fullBooking.date;
                      updateData.startTime = fullBooking.date;
                  }
                  if (fullBooking.endTime !== undefined && fullBooking.endTime !== null) {
                      updateData.endTime = fullBooking.endTime;
                  }
                  if (fullBooking.roomId !== undefined && fullBooking.roomId !== null) {
                      updateData.hallId = fullBooking.roomId;
                  }
                  if (fullBooking.note !== undefined) {
                      updateData.note = fullBooking.note || '';
                  }
                  if (fullBooking.customerId !== undefined && fullBooking.customerId !== null) {
                      updateData.customerId = fullBooking.customerId;
                  }
                  
                  // Sync loại tiệc
                  if (fullBooking.eventType !== undefined) {
                      updateData.eventType = fullBooking.eventType || '';
                  }
                  if (fullBooking.partyType !== undefined) {
                      updateData.partyType = fullBooking.partyType || '';
                  }
                  
                  // Sync các field về số lượng bàn và khách
                  // Booking dùng numberOfTables, Contract dùng tableCount
                  if (fullBooking.numberOfTables !== undefined && fullBooking.numberOfTables !== null) {
                      updateData.tableCount = fullBooking.numberOfTables;
                  }
                  if (fullBooking.reserveTables !== undefined && fullBooking.reserveTables !== null) {
                      updateData.reserveTables = fullBooking.reserveTables;
                  }
                  if (fullBooking.freeTables !== undefined && fullBooking.freeTables !== null) {
                      updateData.freeTables = fullBooking.freeTables;
                  }
                  if (fullBooking.guestCount !== undefined && fullBooking.guestCount !== null) {
                      updateData.guestCount = fullBooking.guestCount;
                  }
                  
                  // Update sales person nếu có thay đổi
                  const salesPersonId = fullBooking.salespersonId || fullBooking.salePersonId;
                  if (salesPersonId) {
                      const salesPerson = await Employee.findById(salesPersonId);
                      if (salesPerson) {
                          updateData.sales = {
                              name: salesPerson.name || 'Phòng Kinh Doanh',
                              title: salesPerson.title || 'Nhân viên tư vấn'
                          };
                      }
                  }

                  // Chỉ update nếu có thay đổi
                  if (Object.keys(updateData).length > 0) {
                      console.log('[Booking after save] Updating contract with data:', JSON.stringify(updateData));
                      // Đặt flag để Contract.after save không sync ngược lại Booking
                      await existingContract.updateAttributes(updateData, {
                          skipSyncFromBookingHook: true
                      });
                      console.log('[Booking after save] Successfully updated contract:', existingContract.id);
                  } else {
                      console.log('[Booking after save] No changes to sync to contract');
                  }
                  
                  return; // Không tạo contract mới khi update
              } else {
                  console.log('[Booking after save] No existing contract found for booking:', fullBooking.id, 'leadId:', fullBooking.leadId);
                  // Tiếp tục với logic tạo contract mới nếu cần
              }
          }

          // Phần code tạo contract mới (chỉ chạy khi create booking)
          const transaction = await Transaction.findOne({
              where: {
                  leadId: booking.leadId,
                  bookingId: {
                    regexp: String(booking.id), // Chuỗi pattern, ví dụ: "^BOOK-2025"
                    options: 'i' 
                  }
              }
          });

          if (!transaction) {
              return;
          }

          const existingContract = await Contract.findOne({
              where: {
                  leadId: booking.leadId,
                  bookingId: {
                    regexp: String(booking.id), // Chuỗi pattern, ví dụ: "^BOOK-2025"
                    options: 'i' 
                  }
              }
          });

          if (existingContract) {
              return;
          }

          const lead = await Lead.findById(booking.leadId, {
              include: ['customers']
          });

          if (!lead) {
              return;
          }

          const toArray = (v) => !v ? [] : Array.isArray(v) ? v : [v];

          const customerIds = lead.customerIds || [];
          const customerId = customerIds.length > 0 ? customerIds[0] : booking.customerId;

          let menuId = null;
          let menuObj = null;
          
          if (lead.menus && Array.isArray(lead.menus) && lead.menus.length > 0) {
            menuId = lead.menus[0];
          } else if (lead.menus && !Array.isArray(lead.menus)) {
            menuId = lead.menus;
          } else if (lead.menuId) {
            menuId = lead.menuId;
          }

          if (menuId) {
            menuObj = await Product.findById(menuId);
            if (menuObj) {
              menuObj = JSON.parse(JSON.stringify(menuObj));
              if (lead.menu && (lead.menu.discountValue || lead.menu.discountPercent)) {
                menuObj.discountValue = lead.menu.discountValue;
                menuObj.discountPercent = lead.menu.discountPercent;
              }
            }
          }

          let beverages = [];
          if (Array.isArray(lead.beverages) && lead.beverages.length > 0) {
            const beverageIds = lead.beverages.map(b => {
              if (b && b.id) return b.id;
              if (typeof b === 'string') return b;
              return null;
            }).filter(Boolean);
            
            if (beverageIds.length > 0) {
              const beverageProducts = await Product.find({
                where: { id: { inq: beverageIds } }
              });
              beverages = beverageProducts.map(b => JSON.parse(JSON.stringify(b)));
            }
          } else if (lead.drinks) {
            const drinkIds = toArray(lead.drinks);
            if (drinkIds.length > 0) {
              const drinkProducts = await Product.find({
                where: { id: { inq: drinkIds } }
              });
              beverages = drinkProducts.map(d => JSON.parse(JSON.stringify(d)));
            }
          }

          let services = [];
          if (Array.isArray(lead.services) && lead.services.length > 0) {
            const serviceIds = lead.services.map(s => {
              if (s && s.id) return s.id;
              if (typeof s === 'string') return s;
              return null;
            }).filter(Boolean);
            
            if (serviceIds.length > 0) {
              const serviceProducts = await Product.find({
                where: { id: { inq: serviceIds } }
              });
              services = serviceProducts.map(s => JSON.parse(JSON.stringify(s)));
            }
          } else if (lead.decorations) {
            const decorationIds = toArray(lead.decorations);
            if (decorationIds.length > 0) {
              const decorationProducts = await Product.find({
                where: { id: { inq: decorationIds } }
              });
              services = decorationProducts.map(d => JSON.parse(JSON.stringify(d)));
            }
          }

          let additionalCharges = [];
          if (Array.isArray(lead.additionalCharges) && lead.additionalCharges.length > 0) {
            for (const charge of lead.additionalCharges) {
              const productId = charge.productId || charge.product;
              let productObj = null;
              
              if (charge.product && charge.product.id) {
                productObj = JSON.parse(JSON.stringify(charge.product));
              } else if (productId) {
                productObj = await Product.findById(productId);
                if (productObj) {
                  productObj = JSON.parse(JSON.stringify(productObj));
                }
              }
              
              additionalCharges.push({
                product: productObj || { id: productId },
                quantity: charge.quantity || 1,
                sellingPrice: charge.sellingPrice || (productObj ? productObj.sellingPrice : 0),
                discountValue: charge.discountValue || 0,
                discountPercent: charge.discountPercent || 0,
                unit: charge.unit || (productObj ? productObj.unit : '')
              });
            }
          }

          const payments = Array.isArray(lead.payments) ? JSON.parse(JSON.stringify(lead.payments)) : [];

          const tableCount = lead.tableCount || Math.ceil((lead.quantity || 0) / 10);
          const reserveTables = (lead.reserveTables === 0 || lead.reserveTables)
            ? lead.reserveTables
            : Math.floor(tableCount / 15);

          const contractDate = new Date();
          const eventDate = lead.eventDate || booking.date || new Date();

          const eventDateObj = new Date(eventDate);
          const year = String(eventDateObj.getFullYear()).slice(-2);
          const month = String(eventDateObj.getMonth() + 1).padStart(2, '0');
          const day = String(eventDateObj.getDate()).padStart(2, '0');
          const hour = String(eventDateObj.getHours()).padStart(2, '0');
          const random = String(Math.floor(Math.random() * 100)).padStart(2, '0');
          const code = `${year}${month}${day}H${hour}LAL${random}`;

          let currentUserId = null;
          const lbCtx = LoopBackContext.getCurrentContext();
          if (lbCtx && lbCtx.get) {
              currentUserId = lbCtx.get('currentUserId') || 
                  (lbCtx.get('currentUser') && lbCtx.get('currentUser').id);
          }

          const representativeName = lead.representativeName || lead.companyRepresentative || null;
          const representativePosition = lead.representativePosition || lead.companyRepPosition || null;
          const representativeEmail = lead.representativeEmail || lead.companyEmail || null;
          const representativePhone = lead.representativePhone || (lead.isOrganization ? lead.phone : null) || null;
          const invoiceContactPosition = lead.invoiceContactPosition || lead.companyRepPosition || lead.representativePosition || '';

          const contractData = {
              leadId: booking.leadId,
              bookingId: booking.id,
              customerId: customerId,
              customerIds: customerIds,
              code: code,
              status: 'draft',
              contractDate: contractDate.toISOString(),
              isOrganization: lead.isOrganization || false,
              isReferral: lead.isReferral || false,
              eventDate: eventDate,
              startTime: lead.eventDate || eventDate,
              endTime: lead.endTime || booking.endTime || null,
              receptionTime: lead.receptionTime || null,
              contactPerson: lead.contactPerson || lead.name || '',
              phone: lead.phone || '',
              email: lead.email || '',
              address: lead.address || '',
              eventName: lead.eventName || ('Tiệc của ' + (lead.isOrganization ? (lead.companyName || '') : (lead.name || ''))),
              partyType: lead.partyType || '',
              eventType: lead.eventType || '',
              guestCount: lead.quantity || lead.guestCount || 0,
              tableCount: tableCount,
              reserveTables: reserveTables,
              freeTables: lead.freeTables || 0,
              hallId: lead.hallId || lead.roomId || booking.roomId || null,
              assignedToId: lead.assignedToId || null,
              operationStatus: 'draft',
              isActive: true,
              createdById: currentUserId || booking.createdById || lead.createdById,
              createdAt: contractDate,
              groomName: lead.groomName || null,
              brideName: lead.brideName || null,
              groomDob: lead.groomDob || null,
              brideDob: lead.brideDob || null,
              groomPhone: lead.groomPhone || null,
              bridePhone: lead.bridePhone || null,
              groomEmail: lead.groomEmail || null,
              brideEmail: lead.brideEmail || null,
              companyName: lead.companyName || null,
              taxCode: lead.taxCode || null,
              companyAddress: lead.companyAddress || null,
              representativeName: representativeName,
              representativePosition: representativePosition,
              representativePhone: representativePhone,
              representativeEmail: representativeEmail,
              invoiceContactPosition: invoiceContactPosition,
              companyWebsite: lead.companyWebsite || '',
              birthdayPersonName: lead.birthdayPersonName || null,
              birthdayPersonDob: lead.birthdayPersonDob || null,
              age: lead.age || null,
              organizerName: lead.organizerName || null,
              relationship: lead.relationship || null,
              organizerPhone: lead.organizerPhone || null,
              organizerEmail: lead.organizerEmail || null,
              anniversaryName: lead.anniversaryName || null,
              anniversaryType: lead.anniversaryType || null,
              anniversaryYears: lead.anniversaryYears || null,
              hostName: lead.hostName || null,
              hostPhone: lead.hostPhone || null,
              hostEmail: lead.hostEmail || null,
              hostAddress: lead.hostAddress || null,
              menu: menuObj,
              menuId: menuObj ? menuObj.id : null,
              beverages: beverages,
              services: services,
              additionalCharges: additionalCharges,
              payments: payments,
              note: lead.note || booking.note || '',
              deposit: 0,
              totalAmount: 0
          };

          if (customerIds.length >= 2) {
              contractData.groomId = customerIds[0];
              contractData.brideId = customerIds[1];
          }

          if (lead.assignedToId) {
              const assignedPerson = await Employee.findById(lead.assignedToId);
              if (assignedPerson) {
                  contractData.sales = {
                      name: assignedPerson.name || 'Phòng Kinh Doanh',
                      title: assignedPerson.title || 'Nhân viên tư vấn'
                  };
              }
          } else if (booking.salespersonId || booking.salePersonId) {
              const salesPersonId = booking.salespersonId || booking.salePersonId;
              const salesPerson = await Employee.findById(salesPersonId);
              if (salesPerson) {
                  contractData.sales = {
                      name: salesPerson.name || 'Phòng Kinh Doanh',
                      title: salesPerson.title || 'Nhân viên tư vấn'
                  };
              }
          }

          await Contract.create(contractData);

      } catch (error) {
          console.error('[Booking after save] Error in hook:', error);
          console.error('[Booking after save] Error stack:', error.stack);
          // Don't throw error to avoid breaking the booking save
      }
  });
};

