// Trigger: Đơn hàng mới được tạo (mở phòng)
// Fired when: SaleOrder created
module.exports = async function(instance) {
    if (!instance || !instance.data) return;

    const app = require('../../server');
    const { User, notification: Notification, Room, Employee, SaleOrderItem, Product, Cfg } = app.models;

    const saleOrder = instance.data;
    console.log('saleorder ', JSON.stringify(saleOrder));
    const orderId = instance.objectId || 'none';

    // Thông tin phòng
    let roomName = 'N/A';
    if (saleOrder.roomId) {
        const room = await Room.findById(saleOrder.roomId);
        if (room) roomName = room.name || room.code || 'Phòng không tên';
    }

    // Nhân viên kinh doanh
    let salePersonName = '';
    if (saleOrder.salePersonId) {
        const salePerson = await Employee.findById(saleOrder.salePersonId);
        if (salePerson) salePersonName = salePerson.fullName || salePerson.name || '';
    }

    // Người tạo đơn — lấy từ createdById trên Log instance (userId thực hiện request)
    let creatorName = '';
    const creatorId = saleOrder.createdById;
    console.log(`[Trigger] SaleOrder.created - creatorId: ${creatorId}, salePersonId: ${saleOrder.salePersonId}`);
    if (creatorId) {
        const creator = await User.findById(creatorId);
        if (creator) creatorName = creator.fullName || creator.username || 'Nhân viên hệ thống';
    }

    // Người phục vụ
    let executorName = '';
    if (saleOrder.executedById) {
        const executor = await User.findById(saleOrder.executedById);
        if (executor) executorName = executor.fullName || executor.username || 'Nhân viên phục vụ';
    }

    const allUserIds = (await User.find({ fields: { id: true } })).map(u => u.id);

    const title = `[${saleOrder.code || 'Mới'}] - Phòng ${roomName}`;
    let content = `Phòng ${roomName} vừa có đơn hàng mới. Tạo bởi: ${creatorName || 'Không rõ'}.`;
    if (executorName && executorName !== creatorName) content += ` Phục vụ bởi: ${executorName}.`;
    if (salePersonName) content += ` Phụ trách bởi: ${salePersonName}.`;
    if (saleOrder.note) content += ` Ghi chú: ${saleOrder.note}`;

    console.log(`[Trigger] SaleOrder.created - Room: ${roomName}, Creator: ${creatorName}`);

    await Notification.create({
        title,
        content,
        receiverIds: allUserIds,
        createdAt: new Date(),
        data: {
            url: `/xad2_/#!/karaoke/reports`,
            objectId: orderId,
            model: 'SaleOrder',
            status: saleOrder.status,
            type: saleOrder.type
        }
    });
    // Web push được gửi tự động qua Notification.afterSave

    // --- Tạo các SaleOrderItem mặc định khi mở phòng ---
    const defaultItems = [
        { name: 'Khăn Lạnh', quantity: 10 },
        { name: 'Khăn giấy', quantity: 1 },
        { name: 'Dĩa bưởi', quantity: 1 },
        { name: 'Dĩa Trái Cây', quantity: 1 },
    ];

    // for (const item of defaultItems) {
    //     try {
    //         const product = await Product.findOne({ where: { name: item.name } });
    //         if (!product) {
    //             console.warn(`[Trigger] SaleOrder.created - Không tìm thấy sản phẩm: ${item.name}`);
    //             continue;
    //         }
    //         let unit = '';
    //         if (product.uomId) {
    //             const uom = await Cfg.findById(product.uomId);
    //             if (uom) unit = uom.nameVi || '';
    //         }
    //         await SaleOrderItem.create({
    //             saleOrderId: orderId,
    //             productId: product.id,
    //             name: product.name,
    //             unit,
    //             quantity: item.quantity,
    //             unitPrice: product.sellingPrice || 0,
    //             subtotal: (product.sellingPrice || 0) * item.quantity,
    //             discount: 0,
    //             note: '',
    //             isActive: true,
    //             isTimeBased: false,
    //         });
    //     } catch (err) {
    //         console.error(`[Trigger] SaleOrder.created - Lỗi tạo item "${item.name}":`, err);
    //     }
    // }
};
