var moment = require('moment');
var app = require('../server');
const constants = {
    DATE: 'DD-MM-YYYY'
}
const funcs = {
    convertArray2DictAndSumQuantity: ({ arr, sumByFields }) => {
        let dict = {}
        arr.forEach(e => {
            let grouptFieldName = [sumByFields.reduce((sum, i) => sum += e[i], '')].join()
            let newQty = dict[grouptFieldName] ? dict[grouptFieldName].quantity : 0
            dict[grouptFieldName] = {
                ...e,
                quantity: e.quantity = e.quantity + newQty
            }
        })
        return dict
    },
    convertDict2Array: (dict) => Object.keys(dict).map(i => dict[i])
}
/***
 * ========== const ==========
 */
const { Import, ImportItem, Export, ExportItem } = app.models
let resData = { msg: 'ok', items: [] }
/***
 * 
 */
const createImport = async ({ importData }) => {
    let result = null
    await Import.create(importData)
        .then((re) => {
            result = re
        })
        .catch(err => {
            console.error(err)
            return null
        })
    return result
}

const getImportItems = async ({ warehouseItemIds, config, toWarehouseId = undefined }) => {
    let result = null
    const { fields = undefined } = config
    await ImportItem.find({
        where: {
            warehouseItemId: { inq: warehouseItemIds },
            toWarehouseId
        },
        fields
    })
        .then((re) => {
            result = re
        })
        .catch(err => {
            console.error(err)
            return null
        })
    return result
}

const getExportItems = async ({ warehouseItemIds, config, warehouseId = undefined }) => {
    let result = null
    const { fields = undefined } = config
    await ExportItem.find({
        where: {            
            warehouseItemId: { inq: warehouseItemIds },
            or: [
                { toWarehouseId: warehouseId },
                { fromWarehouseId: warehouseId }
            ]
        },
        fields
    })
        .then((re) => {
            result = re
        })
        .catch(err => {
            console.error(err)
            return null
        })
    return result
}

const createImportItem = async ({ importData }) => {
    let result = null
    await ImportItem.create(importData)
    return result
}

const createExport = async ({ exportData }) => {
    let result = null
    await Export.create(exportData)
        .then((re) => {
            result = re
        })
        .catch(err => {
            console.error(err)
            return null
        })
    return result
}

const createExportItem = async ({ exportData }) => {
    console.log(exportData, ExportItem.create)
    await ExportItem.create(exportData)
}

module.exports.importInventory = async (req, res) => {
    const { body } = req
    const { importItems } = body
    let importData = {
        ...body,
        importItems: undefined
    }
    const resultImport = await createImport({ importData })
    let importItemHaveImportId = importItems.map(e => ({
        ...e,
        clinicId:resultImport.clinicId,
        importId: resultImport.id,
        toWarehouseId: resultImport.toWarehouseId,
        fromWarehouseId: resultImport.fromWarehouseId
    }))
    createImportItem({ importData: importItemHaveImportId })
    res.status(200).json({ msg: 'ok' })
};

module.exports.exportInventory = async (req, res) => {
    const { body } = req
    const { exportItems } = body
    let exportData = {
        ...body,
        exportItems: undefined
    }
    const resultExport = await createExport({ exportData })
    let exportItemHaveExportId = exportItems.map(e => ({
        ...e,
        clinicId:resultExport.clinicId,
        exportId: resultExport.id,
        toWarehouseId: resultExport.toWarehouseId,
        fromWarehouseId: resultExport.fromWarehouseId
    }))
    createExportItem({ exportData: exportItemHaveExportId })
    res.status(200).json({ msg: 'ok' })
};

module.exports.getWarehouesItemsQty = async (req, res) => {
    let { warehouseItemIds = false, warehouseId = undefined } = req.body
    if (!warehouseId) res.send('missing warehouseId')
    if (!warehouseItemIds)
        res.send(resData)
    const importItem = await getImportItems({ warehouseItemIds, toWarehouseId:warehouseId, config: { fields: { unit: 1, quantity: 1, expiredDate: 1, fromWarehouseId: 1, toWarehouseId: 1, warehouseItemId: 1 } } })
    const exportItem = await getExportItems({ warehouseItemIds, warehouseId:warehouseId, config: { fields: { unit: 1, quantity: 1, expiredDate: 1, fromWarehouseId: 1, toWarehouseId: 1, warehouseItemId: 1 } } })
    const plusItems = exportItem.filter(e => e.toWarehouseId == warehouseId)
    const minusItems = exportItem.filter(e => e.fromWarehouseId == warehouseId)
    const importItemLotByExpiredDate = [...plusItems, ...importItem].map(e => ({ ...e.toJSON(), lot: moment(e.expiredDate).format(constants.DATE) }))
    const arrPlusItemLotAndUnit = funcs.convertDict2Array(funcs.convertArray2DictAndSumQuantity({ arr: importItemLotByExpiredDate, sumByFields: ['lot', 'unit'] }))
    const arrMinusItemLotAndUnit = funcs.convertDict2Array(funcs.convertArray2DictAndSumQuantity({ arr: [...arrPlusItemLotAndUnit,...minusItems.map(i=>({...i.toJSON(), quantity: (-1)*i.quantity, lot: moment(i.expiredDate).format(constants.DATE)}))], sumByFields: ['lot', 'unit'] }))
    res.send({ lotItems: arrMinusItemLotAndUnit })
}