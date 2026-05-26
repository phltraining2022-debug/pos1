/**
 * Lấy danh sách userId của các users thuộc một trong các roles được chỉ định.
 * Manager luôn được tự động thêm vào (manager nhận tất cả thông báo).
 *
 * @param {object} app - LoopBack app (require('../../server'))
 * @param {string[]} roleNames - ví dụ: ['cashier'], ['waiter', 'kitchen']
 * @returns {Promise<string[]>} mảng userId (string, deduplicated)
 */
async function getUserIdsByRoles(app, roleNames) {
    const Role = app.models.Role;
    const RoleMapping = app.models.RoleMapping;

    // Manager luôn nhận tất cả thông báo
    const targetRoles = Array.from(new Set([...roleNames, 'manager']));

    const roles = await Role.find({ where: { name: { inq: targetRoles } } });
    if (!roles.length) return [];

    const roleIds = roles.map(r => r.id);
    const mappings = await RoleMapping.find({
        where: {
            roleId: { inq: roleIds },
            principalType: 'USER',
        }
    });

    // Deduplicate
    return Array.from(new Set(mappings.map(m => String(m.principalId))));
}

module.exports = { getUserIdsByRoles };
