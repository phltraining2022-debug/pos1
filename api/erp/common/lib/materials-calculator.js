/**
 * materials-calculator.js
 *
 * Simple, framework-agnostic helper to compute raw materials required
 * given a contract/menu and a set of recipes (bill-of-materials per dish).
 *
 * Assumptions (kept flexible):
 * - `menu` can be either an array of { dishId, qty } or an object map { [dishId]: qty }.
 * - `recipes` is an object map: { [dishId]: [ { materialId, qtyPerDish, unit, name? }, ... ] }
 * - Quantities are numeric. Units are preserved but not converted.
 *
 * Output shape:
 * {
 *   materials: {
 *     [materialId]: { qty: <number>, unit: <string>, name?: <string> }
 *   }
 * }
 */

function normalizeMenu(menu) {
  if (!menu) return {};
  // If array, convert to map
  if (Array.isArray(menu)) {
    return menu.reduce((acc, item) => {
      const id = item.dishId || item.id || item.name;
      const qty = Number(item.qty || item.quantity || 0) || 0;
      if (!id) return acc;
      acc[id] = (acc[id] || 0) + qty;
      return acc;
    }, {});
  }
  // If already an object map, coerce values to numbers
  if (typeof menu === 'object') {
    return Object.keys(menu).reduce((acc, k) => {
      acc[k] = Number(menu[k]) || 0;
      return acc;
    }, {});
  }
  return {};
}

function calculateMaterials(menu, recipes) {
  const normalizedMenu = normalizeMenu(menu);
  const result = { materials: {} };

  if (!recipes || typeof recipes !== 'object') return result;

  for (const dishId of Object.keys(normalizedMenu)) {
    const dishQty = normalizedMenu[dishId];
    if (!dishQty || dishQty <= 0) continue;

    const recipe = recipes[dishId] || [];
    if (!Array.isArray(recipe)) continue;

    for (const comp of recipe) {
      const mid = comp.materialId || comp.id || comp.sku || comp.name;
      if (!mid) continue;
      const perDish = Number(comp.qtyPerDish || comp.qty || comp.quantity || 0) || 0;
      const unit = comp.unit || comp.u || '';
      const name = comp.name || undefined;

      const addQty = perDish * dishQty;
      if (!result.materials[mid]) {
        result.materials[mid] = { qty: 0, unit: unit, name: name };
      }
      result.materials[mid].qty += addQty;
      // preserve unit if previously empty
      if (!result.materials[mid].unit && unit) result.materials[mid].unit = unit;
      if (!result.materials[mid].name && name) result.materials[mid].name = name;
    }
  }

  // Optionally round small floating point noise
  for (const m of Object.keys(result.materials)) {
    const v = result.materials[m].qty;
    // round to 6 decimal places when needed
    result.materials[m].qty = Math.round((v + Number.EPSILON) * 1e6) / 1e6;
  }

  return result;
}

module.exports = {
  calculateMaterials,
};
