'use strict';
var app = require('../../server/server');
var readFilehandler = require('./readFile');
var _ = require('underscore');
var path = require('path');
var moment = require('moment');
var Q = require('q');
var Parse = require('parse/node');

var Default_Value = {
    Test_Service_Type: 1,
    CDHA_Service_Type: 2,
    Other_Service_Type: 3,
    KhamBenh_Service_Type: 4,
    Unit_Type: "unit",
    Specialization_Type: "chuyenKhoa",
    Department_Type: "phongBan",
    Unit_Type_Test: "test",
    Unit_Type_Medicine: "medicine",
    DoctorConsulationId: "580479d743a45dd7621b52ea",
    VitalSignsId: "58a6daf14b3562050ec3cbbd",
    LabTestId: "58aa998333a60c0b0e04a926",
    DoctorConsulationRoleId: "58da3e1c4a39e7417ea4376b",
    RadiologyCategoryId: "57ef5d7851ce851065e5ce3d",
    GynecologyGroupId: "58dcfba91031a1130994e2a4",
    GynecologyLabTestGroupId: "58117c3954cf158164170414",
    GYNECOLOGICAL_AND_BREAST_SCREENING: "5ab2229a81ea797f5385ed74",
    BREAST_CANCER_SCREENING: "5a69a6e4362db0896e18e761",
    GYNECOLOGICAL_SCREENING: "5a69a78b74d8ddb16eb50f1c"
};



var Category_Cfg = {
    unit: "unit",
    cachDung: "cachDung",
    trieuChung: "trieuChung",
    loiDan: "loiDan",
    duocChatChinh: "duocChatChinh",
    phongBan: "phongBan",
    chuyenKhoa: "chuyenKhoa",
    nhomDichVu: "nhomDichVu",
    loaiDichVu: "loaiDichVu",
    danhGia: "danhGia",
    chuanDoan: "chuanDoan",
    thanhPho: "thanhPho",
    nganHang: "nganHang",
    tinhThanh: "tinhThanh",
    nhomBenhNhan: "nhomBenhNhan",
    toaThuocMau: "toaThuocMau",
    nhomGiaDinh: "nhomGiaDinh",
    thongTinThamVan: "thongTinThamVan",
    moTaKetQua: "moTaKetQua",
    cacVanDe: "cacVanDe",
    thongTinPhongKham: "thongTinPhongKham",
    shift: "shift",
    PromoCodeType: "loaiMaKhuyenMai",
    boXetNghiemMau: "boXetNghiemMau",
    workingDays: "workingDays",
    holidays: "holidays",
    bodyParts: "bodyParts",
    chungNgua: "chungNgua",
    tamSoat: "tamSoat",
    vanDe: "vanDe",
    TCBT: "tienCanBanThan",
    relation: "relation",
    tenBenh: "tenBenh",
    vanDeXH: "vanDeXH",
    thuoc: "thuoc",
    VTYT: "VTYT", // Vật tư y tế
    mucBHYT: "mucBHYT", // Mức bảo hiểm y tế,
    DTBH: "dtbh", // Đối tượng bảo hiểm
    medicalQuestionSection: "medicalQuestionSection",
    testGroup: "testGroup",
    testCategory: "testCategory",
    articleCategory: "articleCategory",
    hocham: "hocham",
    hocvi: "hocvi",
    coSoKhamBenh: "coSoKhamBenh",
    professionalSkill: "professionalSkill",
    notification: "notification"
};

// REMOVE DIACRITIC
var defaultDiacriticsRemovalMap = [
    { 'base': 'A', 'letters': '\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F' },
    { 'base': 'AA', 'letters': '\uA732' },
    { 'base': 'AE', 'letters': '\u00C6\u01FC\u01E2' },
    { 'base': 'AO', 'letters': '\uA734' },
    { 'base': 'AU', 'letters': '\uA736' },
    { 'base': 'AV', 'letters': '\uA738\uA73A' },
    { 'base': 'AY', 'letters': '\uA73C' },
    { 'base': 'B', 'letters': '\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0182\u0181' },
    { 'base': 'C', 'letters': '\u0043\u24B8\uFF23\u0106\u0108\u010A\u010C\u00C7\u1E08\u0187\u023B\uA73E' },
    { 'base': 'D', 'letters': '\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018B\u018A\u0189\uA779' },
    { 'base': 'DZ', 'letters': '\u01F1\u01C4' },
    { 'base': 'Dz', 'letters': '\u01F2\u01C5' },
    { 'base': 'E', 'letters': '\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E' },
    { 'base': 'F', 'letters': '\u0046\u24BB\uFF26\u1E1E\u0191\uA77B' },
    { 'base': 'G', 'letters': '\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E' },
    { 'base': 'H', 'letters': '\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D' },
    { 'base': 'I', 'letters': '\u0049\u24BE\uFF29\u00CC\u00CD\u00CE\u0128\u012A\u012C\u0130\u00CF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197' },
    { 'base': 'J', 'letters': '\u004A\u24BF\uFF2A\u0134\u0248' },
    { 'base': 'K', 'letters': '\u004B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2' },
    { 'base': 'L', 'letters': '\u004C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780' },
    { 'base': 'LJ', 'letters': '\u01C7' },
    { 'base': 'Lj', 'letters': '\u01C8' },
    { 'base': 'M', 'letters': '\u004D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C' },
    { 'base': 'N', 'letters': '\u004E\u24C3\uFF2E\u01F8\u0143\u00D1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u0220\u019D\uA790\uA7A4' },
    { 'base': 'NJ', 'letters': '\u01CA' },
    { 'base': 'Nj', 'letters': '\u01CB' },
    { 'base': 'O', 'letters': '\u004F\u24C4\uFF2F\u00D2\u00D3\u00D4\u1ED2\u1ED0\u1ED6\u1ED4\u00D5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\u00D6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u00D8\u01FE\u0186\u019F\uA74A\uA74C' },
    { 'base': 'OI', 'letters': '\u01A2' },
    { 'base': 'OO', 'letters': '\uA74E' },
    { 'base': 'OU', 'letters': '\u0222' },
    { 'base': 'OE', 'letters': '\u008C\u0152' },
    { 'base': 'oe', 'letters': '\u009C\u0153' },
    { 'base': 'P', 'letters': '\u0050\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754' },
    { 'base': 'Q', 'letters': '\u0051\u24C6\uFF31\uA756\uA758\u024A' },
    { 'base': 'R', 'letters': '\u0052\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782' },
    { 'base': 'S', 'letters': '\u0053\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784' },
    { 'base': 'T', 'letters': '\u0054\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786' },
    { 'base': 'TZ', 'letters': '\uA728' },
    { 'base': 'U', 'letters': '\u0055\u24CA\uFF35\u00D9\u00DA\u00DB\u0168\u1E78\u016A\u1E7A\u016C\u00DC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244' },
    { 'base': 'V', 'letters': '\u0056\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245' },
    { 'base': 'VY', 'letters': '\uA760' },
    { 'base': 'W', 'letters': '\u0057\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72' },
    { 'base': 'X', 'letters': '\u0058\u24CD\uFF38\u1E8A\u1E8C' },
    { 'base': 'Y', 'letters': '\u0059\u24CE\uFF39\u1EF2\u00DD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE' },
    { 'base': 'Z', 'letters': '\u005A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762' },
    { 'base': 'a', 'letters': '\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250' },
    { 'base': 'aa', 'letters': '\uA733' },
    { 'base': 'ae', 'letters': '\u00E6\u01FD\u01E3' },
    { 'base': 'ao', 'letters': '\uA735' },
    { 'base': 'au', 'letters': '\uA737' },
    { 'base': 'av', 'letters': '\uA739\uA73B' },
    { 'base': 'ay', 'letters': '\uA73D' },
    { 'base': 'b', 'letters': '\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253' },
    { 'base': 'c', 'letters': '\u0063\u24D2\uFF43\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184' },
    { 'base': 'd', 'letters': '\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\uA77A' },
    { 'base': 'dz', 'letters': '\u01F3\u01C6' },
    { 'base': 'e', 'letters': '\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u025B\u01DD' },
    { 'base': 'f', 'letters': '\u0066\u24D5\uFF46\u1E1F\u0192\uA77C' },
    { 'base': 'g', 'letters': '\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\u1D79\uA77F' },
    { 'base': 'h', 'letters': '\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265' },
    { 'base': 'hv', 'letters': '\u0195' },
    { 'base': 'i', 'letters': '\u0069\u24D8\uFF49\u00EC\u00ED\u00EE\u0129\u012B\u012D\u00EF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131' },
    { 'base': 'j', 'letters': '\u006A\u24D9\uFF4A\u0135\u01F0\u0249' },
    { 'base': 'k', 'letters': '\u006B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3' },
    { 'base': 'l', 'letters': '\u006C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747' },
    { 'base': 'lj', 'letters': '\u01C9' },
    { 'base': 'm', 'letters': '\u006D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F' },
    { 'base': 'n', 'letters': '\u006E\u24DD\uFF4E\u01F9\u0144\u00F1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5' },
    { 'base': 'nj', 'letters': '\u01CC' },
    { 'base': 'o', 'letters': '\u006F\u24DE\uFF4F\u00F2\u00F3\u00F4\u1ED3\u1ED1\u1ED7\u1ED5\u00F5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\u00F6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\u00F8\u01FF\u0254\uA74B\uA74D\u0275' },
    { 'base': 'oi', 'letters': '\u01A3' },
    { 'base': 'ou', 'letters': '\u0223' },
    { 'base': 'oo', 'letters': '\uA74F' },
    { 'base': 'p', 'letters': '\u0070\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755' },
    { 'base': 'q', 'letters': '\u0071\u24E0\uFF51\u024B\uA757\uA759' },
    { 'base': 'r', 'letters': '\u0072\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783' },
    { 'base': 's', 'letters': '\u0073\u24E2\uFF53\u00DF\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B' },
    { 'base': 't', 'letters': '\u0074\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787' },
    { 'base': 'tz', 'letters': '\uA729' },
    { 'base': 'u', 'letters': '\u0075\u24E4\uFF55\u00F9\u00FA\u00FB\u0169\u1E79\u016B\u1E7B\u016D\u00FC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289' },
    { 'base': 'v', 'letters': '\u0076\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C' },
    { 'base': 'vy', 'letters': '\uA761' },
    { 'base': 'w', 'letters': '\u0077\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73' },
    { 'base': 'x', 'letters': '\u0078\u24E7\uFF58\u1E8B\u1E8D' },
    { 'base': 'y', 'letters': '\u0079\u24E8\uFF59\u1EF3\u00FD\u0177\u1EF9\u0233\u1E8F\u00FF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF' },
    { 'base': 'z', 'letters': '\u007A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763' }
];

var diacriticsMap = {};
for (var i = 0; i < defaultDiacriticsRemovalMap.length; i++) {
    var letters = defaultDiacriticsRemovalMap[i].letters;
    for (var j = 0; j < letters.length; j++) {
        diacriticsMap[letters[j]] = defaultDiacriticsRemovalMap[i].base;
    }
}

module.exports.findDoctors = function (specialities, complete) {
    User.find({
        where: {
            isDoctor: true,
            isActive: true
        },
        fields: {
            id: true
        }
    })
}


module.exports.findUsersByRoles = function (_roles, complete) {
    var Role = app.models.Role;
    var RoleMapping = app.models.RoleMapping;

    var orStatements = _.map(_roles, function (p) {
        return {name: p};
    })

    Role.find({
        where: {
            or: orStatements
        },
        fields: {
            id: true
        }
    }).then(function (roles) {
        console.log('found roles: ', roles.length)
        var userId2Roles = {}
        var roleMap = {}
        _.forEach(roles, (r) => {
            roleMap[r.id] = r;
        })

        RoleMapping.find({
            where: {
                roleId: { inq: _.map(roles, function (r) { return r.id }) }
            }
        }).then(function (rolmap) {
            var userIds = _.map(rolmap, function (m) {
                return m && m.principalId
            });

            _.forEach(rolmap, (rm) => {
                if (userId2Roles[rm.principalId]) 
                    userId2Roles[rm.principalId].push(rm.roleId)
                else 
                    userId2Roles[rm.principalId] = [rm.roleId]
            })

            complete(_.unique(userIds), userId2Roles, roleMap);
        }, function (e) {
            console.log('e ');
            
            complete(null, e);
        });

    }, function (e) {
        complete(null, e);
    });
}

module.exports.findUsersByPermissions = function (permissions, complete) {
    var Role = app.models.Role;
    var RoleMapping = app.models.RoleMapping;

    var orStatements = _.map(permissions, function (p) {
        var k = "permissions." + p; var m = {}; m[k] = true
        return m;
    });

    Role.find({
        where: {
            or: orStatements
        }
        // ,
        // fields: {
        //     id: true
        // }
    }).then(function (roles) {
        console.log('found roles: ', roles.length)
        var userId2Roles = {}
        var roleMap = {}
        _.forEach(roles, (r) => {
            roleMap[r.id] = r;
        })

        RoleMapping.find({
            where: {
                roleId: { inq: _.map(roles, function (r) { return r.id }) }
            }
        }).then(function (rolmap) {
            var userIds = _.map(rolmap, function (m) {
                return m && m.principalId
            });

            _.forEach(rolmap, (rm) => {
                if (userId2Roles[rm.principalId]) 
                    userId2Roles[rm.principalId].push(rm.roleId)
                else 
                    userId2Roles[rm.principalId] = [rm.roleId]
            })

            complete(_.unique(userIds), userId2Roles, roleMap);
        }, function (e) {
            console.log('e ');
            
            complete(null, e);
        });

    }, function (e) {
        complete(null, e);
    });
}

module.exports.createOrderItems = function (orderId, complete) {
    var Order = app.models.order;
    var Test = app.models.test;
    var OrderItem = app.models.orderItem;

    Order.findOne({
        where: {
            or: [{MDH: orderId}, {id: orderId}]
        },
        include: [
            "patient", "package",
            {
                relation: "orderItems",
                scope: {
                    include: ["service", "test"]
                }
            }
        ]
    }, function (err, order) {
        var order = JSON.parse(JSON.stringify(order));
        var packageTestMap = {};
        var tests = [];
        
        _.forEach(order.package.tests, (t) => { var t = JSON.parse(t); tests.push(t.id); packageTestMap[t.id] = t })

        _.forEach(order.orderItemObjs, (obj) => { 
            if (obj.tid) tests.push(obj.tid);
            if (obj.sid) tests.push(obj.sid);
         })


        var orderItems = {};
        _.forEach(order.orderItems, (oi) => {
            orderItems[oi.test && oi.test.id || oi.service && oi.service.id] = true;
        });

        var missing = [];

        _.forEach(tests, (t) => {
            if (!orderItems[t]) {
                missing.push(t);
            }
        });

        var orderItemsToCreate = [];
        Test.find({
            where: {
                id: {inq: missing}
            },
            include: ["subTests"]
        }, function (err, tests) {
            tests = JSON.parse(JSON.stringify(tests));
            var items = [];
            _.forEach(tests, (t) => {
                items.push({
                    "orderId" : order.id, 
                    "status" : "new", 
                    "testId" : t.id, 
                    "type" : t.sampleType ? 1: 0, 
                    "clinicId" : order.clinicId, 
                    "isActive" : true, 
                    "clinicIds" : [
                        order.clinicId
                    ], 
                    "patientId" : order.patientId, 
                    "isOptional" : packageTestMap[t.id].isOptional, 
                    "isFree" : packageTestMap[t.id].isFree
                });

                if (t.subTests) {
                    console.log('subtest ', t.subTests);
                    _.forEach(t.subTests, (st) => {
                        if (st)
                            items.push({
                                "orderId" : order.id, 
                                "status" : "new", 
                                "name": "sub",
                                "testId" : st.id, 
                                "type" : st.sampleType ? 1: 0, 
                                "clinicId" : order.clinicId, 
                                "isActive" : true, 
                                "clinicIds" : [
                                    order.clinicId
                                ], 
                                "patientId" : order.patientId, 
                                "isOptional" : packageTestMap[st.id] && packageTestMap[st.id].isOptional, 
                                "isFree" : packageTestMap[st.id] && packageTestMap[st.id].isFree
                            });
                    });
                }
            });


            if (order.packageId) {
                // Automactically create doctor consulation / lab test / vital signs to check up package 

                if (!order.package.isNotCheckUp) {
                    if (!orderItems[Default_Value.VitalSignsId])
                        items.push({
                            orderId: order.id,
                            status: 'new',
                            type: 0,
                            testId: Default_Value.VitalSignsId,
                            clinicId: order.clinicId
                        });

                    if (!orderItems[Default_Value.DoctorConsulationId])
                        items.push({
                                orderId: order.id,
                                status: 'new',
                                type: 2,
                                serviceId: Default_Value.DoctorConsulationId,
                                clinicId: order.clinicId
                            });
                }

                if (!orderItems[Default_Value.LabTestId])
                    items.push({
                        orderId: order.id,
                        status: 'new',
                        type: 0,
                        testId: Default_Value.LabTestId,
                        clinicId: order.clinicId
                    });
            }

            
            
            OrderItem.create(items, function(err, objs  ) {
                console.log('err ', err, objs);
                complete && complete(err, objs);
            })
        });
    });
}

module.exports.sendNotificationToUsersHaveTaskPermission = function (
        notificationType, taskName,
        userIds, userId2Roles, roleMap, 
        order, instance, eventType) {
                        
    // Checkup.v => view all tests 
    // COBASIT => vie all lab tests
    // Doctor.v Nurse.v => sub tests
    var orderItems =  _.map(_.filter(order.orderItems, (oi) => {
        return (oi.test && !oi.test.referenceTest) || oi.service;
    }), function(oi) {
        return {
            id: oi.id, 
            doctorName: order.createdBy && order.createdBy.fullName,
            doctorId: order.createdById,
            name: (oi.test && oi.test.name) || (oi.service && oi.service.name)
        }
    })

    var labOrderItems = _.map(_.filter(order.orderItems, (oi) => {return oi.test.sampleType}), 
        function(oi) {
            return {id: oi.id, name: oi.test.name}
        })

    var nonLabOrderItems = _.map(_.filter(order.orderItems, (oi) => {return !oi.test || !oi.test.sampleType}), 
        function(oi) {
            return {id: oi.id, name: (oi.test && oi.test.name) || (oi.service && oi.service.name)}
        }
    )

    var usersAll = new Set();
    var usersLab = new Set();
    var nurseAndDoctors = new Set();
    
    _.forEach(userIds, (uid) => {
        _.forEach(userId2Roles[uid], (rid) => {
            var role = roleMap[rid]
            if (role.permissions && role.permissions.Checkup && role.permissions.Checkup.v) {
                usersAll.add(uid)
            }
        })
    })

    if (labOrderItems.length > 0) {
        _.forEach(userIds, (uid) => {
            if (!usersAll.has(uid) && !nurseAndDoctors.has(uid)) {
                _.forEach(userId2Roles[uid], (rid) => {
                    var role = roleMap[rid]
                    if (role.permissions && role.permissions.COBASIT && role.permissions.COBASIT.v) {
                        usersLab.add(uid)
                    }
                })
            }
        })
    }
    
    var testSet2Users = {
        // number => {testSets, userIds}
    }

    if (usersAll.size) {
        testSet2Users[_.map(orderItems, (t) => {return t.name}).join('').length] = {testSet: orderItems, uids: Array.from(usersAll)}
    }

    if (usersLab.size) {
        testSet2Users[_.map(labOrderItems, (t) => {return t.name}).join('').length] = {testSet: orderItems, uids: Array.from(usersLab)}
    }

    var userIdsAndTests = _.map(testSet2Users, (v, k) => {return v})

    // Nurse & Doctor
    _.forEach(userIds, (uid) => {
        if (!usersAll.has(uid)) {
            var testSet = [];

            _.forEach(userId2Roles[uid], (rid) => {
                var perms = roleMap[rid].permissions;
                if ( perms && ((perms.Nurse && perms.Nurse.v) ||
                (perms.Doctor && perms.Doctor.v)) )  {
                    // match list
                    
                    var testNames = _.filter(nonLabOrderItems, (t) => {
                        return (perms.Nurse && perms.Nurse[t.name] && perms.Nurse[t.name].v) || 
                                (perms.Doctor && perms.Doctor[t.name] && perms.Doctor[t.name].v);
                    })

                    testSet = testSet.concat(testNames)

                    var labTestNames = _.filter(labOrderItems, (t) => {
                        return (perms.Nurse && perms.Nurse['Lab Test'] && perms.Nurse['Lab Test'].v) ||
                             (perms.Doctor && perms.Doctor['Lab Test'] &&perms.Doctor['Lab Test'].v);
                    });

                    testSet = testSet.concat(labTestNames)   
                }
            })

            testSet = _.unique(testSet)
            
            if (testSet.length) {
                var xId = _.map(testSet, (t) => {return t.name}).join('').length;
                if (!testSet2Users[xId]) 
                    testSet2Users[xId] = {testSet: testSet, uids: [uid]}
                else  
                    testSet2Users[xId].uids.push(uid)
            }
            
        }
    })

    var userIdsAndTests = _.map(testSet2Users, (v, k) => {return v})


    console.log('userIdsAndTest !!! ', userIdsAndTests);

    _.forEach(userIdsAndTests, (userIdsAndTest) => {
        module.exports.sendNotification('system', 
            { 
                text: order.patient.fullName + ' ' +  (eventType || taskName || '') + ' ' + _.map(userIdsAndTest.testSet, (i) => { return i.name}).join(', ')
            },
            userIdsAndTest.uids, 
            function () {
                console.log('complete notification');
            }, { 
                "type": notificationType, 
                "taskName": taskName, 
                "isDone": false, 
                "priority": instance.priority, 
                orderId: order.id,
                event: eventType,
                orderItems: userIdsAndTest.testSet
        })
    })
}  


module.exports.removeDiacritics = function (str) {
    return str ? str.replace(/[^\u0000-\u007E]/g, function (a) {
        return diacriticsMap[a] || a;
    }) : null;
};

module.exports.sendNotification = function (from, data, targets, complete, extras) {
    Parse.initialize("hat-app");
    Parse.serverURL = 'http://127.0.0.1:1338/parse';

    var Notification = Parse.Object.extend("piNotification");
    var n = new Notification();

    n.set({
        "targets": targets,
        "data": data,
        "from": from,
        "isRead": false
    });

    n.set(extras);
    n.save(null, {
        success: function (_n) {
            complete(_n);
        },
        error: function (_n, error) {
            console.log('Failed to create new object, with error code: ' + error.message);
            complete(_n, error);
        }
    });
}


function insertData(data, model, cb) {
    console.log(data);
    console.log("The model: ", model);
    if (data && model)
        model.upsert(data, function (error, result) {
            cb && cb(error, result);
            if (error)
                console.log("error!!!", error);
            else
                console.log("success!!!", result);
        })
};
// End remove DIACRITIC
// module.exports.initCachDung = function (clinicId) {
//  var SysCfg = app.models.SysCfg;
//       SysCfg.find({
//         where: {
//             clinicId: "",
//             category: Category_Cfg.cachDung
//         }
//     }, function (error, results) {
//      var cds = _.map(results, function (item) {
//         item.id = null;
//         item.clinicId = clinicId;
//         item.searchName = item.name.toLowerCase();
//         item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//         item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//         return item;
//     });
//         insertData(cds, app.model.SysCfg)
//     })
// };

module.exports.importICD10Eng = function (clinicId) {
    readFilehandler.readFile('icd10.json', function (err, data) {
        if (!err) {
            var importData = JSON.parse(data);
            var dataInsert = _.map(importData, function (d) {
                var c = d.Field2.split(' ');
                c.splice(0, 1);
                var drepcription = c.join(' ')
                var result = {
                    clinicId: clinicId,
                    category: 'ICD10',
                    ICD10: d.Code.split(' ')[0],
                    name: drepcription,
                    isActive: true,
                    searchName: drepcription.toLowerCase(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    get searchKeywords() {
                        return [
                            this.ICD10,
                            this.ICD10.toLowerCase(),
                            drepcription.toLowerCase(),
                            module.exports.removeDiacritics(drepcription.toLowerCase()),
                        ].concat(drepcription.split(' '))
                    }
                };
                return result;
            })
            insertData(dataInsert, app.models.SysCfg);
        }
    })
}

module.exports.initICD10 = function (clinicId) {

    readFilehandler.readFile('icd10V.json', function (err, data) {
        if (!err) {
            data = data.replace(data[0], "");
            var icdData = JSON.parse(data);

            var dataToInsert = _.map(icdData, function (icd) {
                icd.originalDiseaseName = icd.originalDiseaseName[0] == " "
                    ? icd.originalDiseaseName.replace(icd.originalDiseaseName[0], "")
                    : icd.originalDiseaseName;
                var name = icd.originalDiseaseName ? icd.originalDiseaseName.toLowerCase() : "";
                var result = {
                    clinicId: "",
                    category: "chuanDoan",
                    name: icd.originalDiseaseName ? icd.originalDiseaseName : "",
                    searchName: name,
                    isActive: true,
                    isLocked: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    ICD10: icd.code.split('.').join("").toString()
                }
                result.searchCode = result.ICD10.toLowerCase();
                var removedDiacriticName = module.exports.removeDiacritics(icd.originalDiseaseName ? icd.originalDiseaseName.toLowerCase() : "");
                result.searchWithoutDiacritics = removedDiacriticName;
                result.searchEnglishName = icd.diseaseName ? icd.diseaseName.replace(',', "") : "";


                // add search keywords
                result.searchKeywords = [result.ICD10, removedDiacriticName ? removedDiacriticName : '', name, icd.diseaseName ? icd.diseaseName : ''];
                result.clinicId = clinicId ? clinicId : "";

                return result;
            });

            insertData(dataToInsert, app.models.SysCfg);
        }

    });
};

module.exports.initBank = function (clinicId) {
    if (!clinicId) return;
    app.models.bank.find({ filter: { where: { clinicId: "" } } }, function (error, result) {
        var banks = _.map(result, function (bank) {
            bank.searchKeywords = _.uniq([bank.name, module.exports.removeDiacritics(bank.name)]).join(" ");
            bank.createdAt = new Date();
            bank.updatedAt = new Date();
            bank.id = null;
            bank.clinicId = clinicId;
            bank.searchName = bank.name.toLowerCase();
            bank.searchWithoutDiacritics = module.exports.removeDiacritics(bank.name).toLowerCase();
            return bank;
        });

        insertData(banks, app.models.bank);
    });
};

// module.exports.initCDHA = function (clinicId) {
//     app.models.service.find(
//         {
//             where: {
//                 and: [
//                     { clinicId: "" },
//                     { serviceType: Default_Value.CDHA_Service_Type }
//                 ]
//             }
//         }, function (error, result) {
//             var cdha = _.map(result, function (item) {
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name)]).join(" ");
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 return item;
//             });

//             insertData(cdha, app.models.service);
//         });


// };

// module.exports.initTest = function (clinicId) {
//     app.models.service.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { serviceType: Default_Value.Test_Service_Type }
//             ]
//         }
//     }, function (error, result) {
//         var tests = _.map(result, function (item) {
//             item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name)]).join(" ");
//             item.id = null;
//             item.clinicId = clinicId;
//             item.searchName = item.name.toLowerCase();
//             item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//             return item;
//         });

//         insertData(tests, app.models.service);
//     });
// };

// module.exports.initMedicalRecord = function (clinicId) {
//     app.model.MedicalRecord.find({
//         where: {
//             clinicId: ''
//         }
//     }, function (error, results) {
//         var medicalRecords = _.map(results, function (item) {
//             if (item) {
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 // item.searchWithoutDiacritics = module.exports.removeDiacritics(m.name).toLowerCase();
//                 return item;
//             }
//         });
//         insertData(medicalRecords, app.model.MedicalRecord)
//     })
// }


module.exports.initMedicineFami = function (clinicId) {
    app.models.medicine.find({
        where: {
            clinicId: ''
        }
    }, function (error, result) {
        if (result) {
            var medicines = _.map(result, function (medicine) {
                if (medicine && medicine.name) {
                    medicine.searchKeywords = _.uniq([medicine.name, module.exports.removeDiacritics(medicine.name)]).join(" ");
                    medicine.id = null;
                    medicine.clinicId = clinicId;
                    medicine.clinicIds = [clinicId];
                    medicine.searchName = medicine.name.toLowerCase();
                    medicine.searchWithoutDiacritics = module.exports.removeDiacritics(medicine.name).toLowerCase();
                    return medicine;
                }
            });
            console.log('init medicince ...');
            insertData(medicines, app.models.medicine);
        }
    })

};

module.exports.initSpecialization = function (clinicId) {
    app.models.SysCfg.find({
        where: {
            and: [
                { clinicId: "" },
                { category: Default_Value.Specialization_Type }
            ]
        }
    }, function (error, result) {
        var spe = _.map(result, function (item) {
            item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name)]).join(" ");
            item.id = null;
            item.clinicId = clinicId;
            item.searchName = item.name.toLowerCase();
            item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
            return item;
        });

        insertData(spe, app.models.SysCfg);
    });
};

module.exports.initDepartment = function (clinicId) {
    app.models.SysCfg.find({
        where: {
            and: [
                { clinicId: "" },
                { category: Default_Value.Department_Type }
            ]
        }
    }, function (error, result) {
        var departments = _.map(result, function (item) {
            item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name)]).join(" ");
            item.id = null;
            item.clinicId = clinicId;
            item.searchName = item.name.toLowerCase();
            item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
            return item;
        });

        insertData(departments, app.models.SysCfg);
    });
};

// Double??? why????
// module.exports.initMedicine = function (clinicId) {
//     app.models.Medicine.find({
//         where: {
//             clinicId: ""
//         }
//     }, function (error, result) {
//         if (result) {
//             var medicines = _.map(result, function (item) {
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 return item;
//             });
//
//             insertData(medicines, app.models.Medicine);
//         }
//     });
// };

// module.exports.initCachDung = function () {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.cachDung }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var cachDung = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });
//
//             insertData(cachDung, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initAdvised = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.loiDan }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var advised = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(advised, app.models.SysCfg);
//         }
//     });
// };

module.exports.initGroupService = function (clinicId, complete) {
    var initialGroupService2NewClinicGroupService = {};
    app.models.SysCfg.find({
        where: {
            and: [
                { clinicId: "" },
                { category: Category_Cfg.nhomDichVu },
                { typeClinic: { eq: null } }
            ]
        }
    }, function (error, result) {
        if (result) {
            var groupService = _.map(result, function (item) {
                initialGroupService2NewClinicGroupService[item.id]
                item.oldId = item.id;
                item.id = null;
                item.clinicId = clinicId;
                item.searchName = item.name.toLowerCase();
                item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                return item;
            });
            insertData(groupService, app.models.SysCfg, function (err, results) {
                for (var i = 0; i < groupService.length; i++) {
                    var result = groupService[i];
                    initialGroupService2NewClinicGroupService[result.oldId] = result.id;
                }
                complete(initialGroupService2NewClinicGroupService);
            });
        }
    });
};

module.exports.initServiceType = function (clinicId, dictGroup, complete) {
    var initTypeService2NewClinicTypeService = {}

    app.models.SysCfg.find({
        where: {
            and: [
                { clinicId: "" },
                { category: Category_Cfg.loaiDichVu },
                { typeClinic: { eq: null } }
            ]
        }
    }, function (error, result) {
        // update new groupService
        if (result) {
            var serviceType = _.map(result, function (item) {
                initTypeService2NewClinicTypeService[item.id];
                item.oldId = item.id;
                item.id = null;
                item.clinicId = clinicId;
                item.parentId = dictGroup[item.parentId];
                item.searchName = item.name.toLowerCase();
                item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                return item;
            });

            insertData(serviceType, app.models.SysCfg, function (err, results) {
                // cb && cb();
                for (var i = 0; i < serviceType.length; i++) {
                    var result = serviceType[i];
                    initTypeService2NewClinicTypeService[result.oldId] = result.id;
                }
                complete(initTypeService2NewClinicTypeService)
            });
        }
    });
};

module.exports.initService = function (clinicId, dictGroup, dictType, complete) {
    var initService2NewClinicService = {};
    var service = app.models.Service;
    service.find({
        where: {
            clinicId: "",
            typeClinic: { eq: null }

        }
    }, function (error, result) {
        if (result) {
            var services = _.map(result, function (s) {
                if (s && s.name) {
                    initService2NewClinicService[s.id];
                    s.oldId = s.id;
                    s.id = null;
                    s.clinicId = clinicId;
                    s.serachName = s.name.toLowerCase();
                    s.groupId = dictGroup[s.groupId];
                    s.typeId = dictType[s.typeId];
                    return s;
                }
            })
            insertData(services, service, function (err, results) {
                for (var i = 0; i < services.length; i++) {
                    var result = services[i];
                    initService2NewClinicService[result.oldId] = result.id;
                }
                complete(initService2NewClinicService)
            })
        }
    })
}

// module.exports.initUnitMedicine = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.unit },
//                 { type: Default_Value.Unit_Type_Medicine }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var units = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(units, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initDescribedResults = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.moTaKetQua }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var describedResults = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(describedResults, app.models.SysCfg);
//         }
//     });
// };

module.exports.initParameter = function (clinicId) {
    app.models.Test.find({
        where: {
            clinicId: ""
        }
    }, function (error, result) {
        if (result) {
            var parameters = _.map(result, function (item) {
                if (item && item.name) {
                    item.id = null;
                    item.clinicId = clinicId;
                    item.searchName = item.name.toLowerCase();
                    item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                    item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                    return item;
                }
            });

            insertData(parameters, app.models.Test);
        }
    });
};

// BoXN la Xet nghiem
// module.exports.initBoXN = function (clinicId) {
//     app.models.Service.find({
//         where: {
//             clinicId: ""
//         }
//     }, function (error, result) {
//         if (result) {
//             var boXN = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });
//
//             insertData(boXN, app.models.Service);
//         }
//     });
// };

module.exports.initReportTemplate = function (clinicId) {
    app.models.ReportTemplate.find({
        where: {
            clinicId: ''
        }
    }, function (error, result) {
        var reportTemplates = _.map(result, function (item) {
            item.id = null;
            item.clinicId = clinicId;
            item.searchName = item.name.toLowerCase();
            item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
            item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
            return item;
        });

        insertData(reportTemplates, app.models.ReportTemplate);
    });
};

module.exports.initSysCfgs = function (clinicId) {
    app.models.SysCfg.find({
        where: {
            and: [
                {
                    category: {
                        inq: [Category_Cfg.bodyParts, Category_Cfg.chungNgua, Category_Cfg.tamSoat, Category_Cfg.cachDung,
                        Category_Cfg.duocChatChinh,
                        Category_Cfg.DTBH, Category_Cfg.unit, Category_Cfg.danhGia,
                        Category_Cfg.vanDe, Category_Cfg.relation, Category_Cfg.vanDeXH, Category_Cfg.trieuChung, Category_Cfg.thongTinThamVan,
                        Category_Cfg.loiDan, Category_Cfg.moTaKetQua, Category_Cfg.mucBHYT]
                    }
                },
                { clinicId: "" }
            ]
        }
    }, function (error, result) {
        if (result) {
            var SysCfgs = _.map(result, function (item) {
                if (item && item.name) {
                    item.id = null;
                    item.clinicId = clinicId;
                    item.searchName = item.name.toLowerCase();
                    item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                    item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                    return item;
                }
            });
            insertData(SysCfgs, app.models.SysCfg);
        }
    });
};

module.exports.initRole = function (clinicId) {
    app.models.Role.find({
        where: {
            clinicId: ""
        }
    }, function (error, result) {
        if (result) {
            var roles = _.map(result, function (item) {
                item.id = null;
                item.clinicId = clinicId;
                item.searchName = item.name.toLowerCase();
                item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                return item;
            });

            insertData(roles, app.models.Role);
        }
    });
};

module.exports.initNhomDichVu = function (clinicId) {
    var data = [
        {
            name: "Xét Nghiệm",
            category: "nhomDichVu",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "CĐHA",
            category: "nhomDichVu",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Khám bệnh",
            category: "nhomDichVu",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Chỉ định khác",
            category: "nhomDichVu",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        }
    ];

    insertData(data, app.models.SysCfg);
};

module.exports.initHocHam = function (clinicId) {
    var data = [
        {
            name: "Giáo sư",
            category: "hocham",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Phó giáo sư",
            category: "hocham",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        }
    ];

    insertData(data, app.models.SysCfg);
};

module.exports.initHocVi = function (clinicId) {
    var data = [
        {
            name: "Cử nhân",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Bác sĩ",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Thạc sĩ",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Tiến sĩ",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Kỹ sư",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Dược sĩ",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Cao đẳng",
            category: "hocvi",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        }
    ];

    insertData(data, app.models.SysCfg);
};

module.exports.initMedicine = function () {
    readFilehandler.readFile('../../medicine.json', function (err, data) {
        if (data) {
            var icdData = JSON.parse(data);
            var dataToInsert = _.map(icdData, function (med) {
                var name = med.name ? med.name : "";
                var result = {
                    clinicId: "57d8ce790bf89f8731945b15",
                    name: name,
                    searchName: name.toLowerCase().split(' '),
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    note: med.note
                };

                return result.name && result.name.indexOf('.') < 0 ? result : null;
            }).filter(function (med) {
                return med;
            });

            insertData(dataToInsert, app.models.medicine);
        }

    });
};


module.exports.initChuyenMon = function (clinicId) {
    var data = [
        {
            name: "Chuyên khoa 1",
            category: "chuyenmon",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Chuyên khoa 2",
            category: "chuyenmon",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Cử nhân",
            category: "chuyenmon",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Cao đẳng",
            category: "chuyenmon",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        },
        {
            name: "Trung cấp",
            category: "chuyenmon",
            clinicId: clinicId ? clinicId : "",
            isActive: true,
            isLocked: false
        }
    ];

    insertData(data, app.models.SysCfg);
};

module.exports.calculateClinicRank = function (clinicId) {
    var User = app.models.clinic;
    var dfd = Q.defer();
    User.find({
        where: {
            or: [
                { clinicId: clinicId },
                { clinicIds: { inq: [clinicId] } }
            ]
        },
        fields: {
            rank: 1
        }
    }).then(function (doctors) {
        var totalRank = 0;
        doctors.forEach(function (d) {
            totalRank += d.rank;
        });

        var result = totalRank / doctors.length;
        dfd.resolve(result);
    }, function (error) {
        console.log(error)
        dfd.reject(error);
    });

    return dfd.promise;
};

module.exports.initPatientGroup = function (clinicId) {
    var PatientGroup = app.models.PatientGroup;
    // var dfd = Q.defer();
    PatientGroup.find({
        where: {
            and: [
                { clinicId: '' },
                { typeClinic: { eq: null } }
            ]
        }
    }, function (error, result) {
        if (result) {
            var patientGroups = _.map(result, function (item) {
                if (item && item.name) {
                    item.id = null;
                    item.clinicId = clinicId;
                    item.clinicIds = [clinicId];
                    // item.searchName = item.name.toLowerCase();
                    // item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                    // item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                    return item;
                }
            });
            insertData(patientGroups, PatientGroup);
        }
    });
};

module.exports.initFakeData = function () {
    var data = {
        firstName: "HEHE",
        lastName: "ZE ZE",
        email: "test@.com",
        phoneNumber: "102563987165461318465165",
        DBO: moment.utc()
    };

    var Patient = app.models.patient;

    var results = [];
    var chars = "abcdefghijklmnopqrstuvwxyz";

    for (var i = 0; i < 10000; i++) {
        var characters = chars.charAt(Math.floor(Math.random() * chars.length));
        var p = {
            firstName: characters + "HEHE",
            lastName: "ZE ZE",
            email: "test@.com",
            phoneNumber: "102563987165461318465165",
            DBO: moment.utc()
        }
        results.push(p);
    }

    Patient.upsert(results, function (error, result) {
        if (error)
            console.log("error!!!", error);
        else
            console.log("success!!!", result);
    })
};

module.exports.initFakeUser = function () {
    var User = app.models.user;

    var results = [];
    var chars = "abcdefghijklmnopqrstuvwxyz";

    for (var i = 0; i < 10000; i++) {
        var characters = chars.charAt(Math.floor(Math.random() * chars.length));
        var p = {
            firstName: characters + "user",
            lastName: " " + i,
            email: "testUs@.com",
            phoneNumber: "1984381248988128",
            DBO: moment.utc()
        }
        results.push(p);
    }

    User.upsert(results, function (error, result) {
        if (error)
            console.log("error!!!", error);
        else
            console.log("success!!!", result);
    })
}

module.exports.initFakeClinic = function () {
    var data = {
        firstName: "HEHE",
        lastName: "ZE ZE",
        email: "test@.com",
        phoneNumber: "102563987165461318465165",
        DBO: moment.utc()
    };

    var Patient = app.models.patient;

    var results = [];
    var chars = "abcdefghijklmnopqrstuvwxyz";

    for (var i = 0; i < 10000; i++) {
        var characters = chars.charAt(Math.floor(Math.random() * chars.length));
        var p = {
            firstName: characters + "HEHE",
            lastName: "ZE ZE",
            email: "test@.com",
            phoneNumber: "102563987165461318465165",
            DBO: moment.utc()
        }
        results.push(p);
    }

    Patient.upsert(results, function (error, result) {
        if (error)
            console.log("error!!!", error);
        else
            console.log("success!!!", result);
    })
};

module.exports.getDataByQuery = function (modelName, query) {
    var model = app.models[modelName.toString()];
    var dfd = Q.defer();

    model.find(query).then(function (result) {
        dfd.resolve(result);
    }, function (error) {
        dfd.reject(error);
    });

    return dfd.promise;
};

module.exports.getTemplateByName = function (tplName) {
    var Template = app.models.template;
    var dfd = Q.defer();
    Template.findOne({
        where: {
            name: tplName
        }
    }).then(function (tpl) {
        dfd.resolve(tpl);
    }, function (error) {
        dfd.reject(error);
    });

    return dfd.promise;
};

// module.exports.initDuocChatChinh = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.duocChatChinh }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var duocChatChinh = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(duocChatChinh, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initPrescription = function (clinicId, dictMed) {
//     app.models.Prescription.find({
//         where: {
//             clinicId: ""
//         }
//     }, function (error, result) {
//         if (result) {
//             var prescriptions = _.map(result, function (item) {
//                 item.meds = _.map(dictMed, function(item){
//                     return
//                 })
//                 item.id = null;
//                 item.clinicId = clinicId;
// item.searchName = item.name.toLowerCase();
// item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
// item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(prescriptions, app.models.Prescription);
//         }
//     });
// };

// module.exports.initTrieuChung = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.trieuChung }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var trieuChung = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(trieuChung, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initThongTinThamVan = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.thongTinThamVan }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var thongTinThamVan = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(thongTinThamVan, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initBodyParts = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.bodyParts }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var bodyParts = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(bodyParts, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initChungNgua = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.chungNgua }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var chungNgua = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(chungNgua, app.models.SysCfg);
//         }
//     });
// };



module.exports.initServicePackage = function (clinicId, dictService, cb) {
    app.models.ServicePackage.find({
        where: {
            and: [
                { clinicId: '' },
                { typeClinic: { eq: null } }
            ]
        }
    }, function (error, result) {
        if (result) {
            var servicePackages = _.map(result, function (item) {
                // item.services = _.map(dictService, function (i) {
                //     return dictService[i.id]
                // })
                if (item.services && item.services.length) {
                    var s = []
                    for (var i = 0; i < item.services.length; i++) {
                        s.push(dictService[item.services[i]])
                        console.log("dict", dictService[item.services[i]])
                    }
                    item.services = s;
                    console.log("services", s)
                }

                item.id = null;
                item.clinicId = clinicId;
                item.searchName = item.name.toLowerCase();
                item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                return item;
            });

            insertData(servicePackages, app.models.ServicePackage, function () {
                cb && cb()
            });
        }
    });
};


// module.exports.initMucBHYT = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.mucBHYT }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var mucBHYT = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(mucBHYT, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initDTBH = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.DTBH }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var dtbh = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(dtbh, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initCoSoKhamBenh = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.coSoKhamBenh }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var coSoKhamBenh = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(coSoKhamBenh, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initUnitTest = function (clinicId) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.unit },
//                 { type: Default_Value.Unit_Type_Test }
//             ]
//         }
//     }, function (error, result) {
//         if (result) {
//             var units = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicId ? clinicId : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(units, app.models.SysCfg);
//         }
//     });
// };

// module.exports.initGoiXetNghiemMau = function (clinicId, dictService, cb) {
//     app.models.SysCfg.find({
//         where: {
//             and: [
//                 { clinicId: "" },
//                 { category: Category_Cfg.boXetNghiemMau },
//                 { typeClinic: { eq: null } }
//             ]

//         }
//     }, function (error, result) {
//         if (result) {
//             var initGoiXetNghiemMau = _.map(result, function (item) {
//                 item.testId = _.map(dictService, function (i) { return dictService[i.id] })
//                 item.id = null;
//                 item.clinicId = clinicId;
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 return item;
//             });

//             insertData(initGoiXetNghiemMau, app.models.SysCfg, function () {
//                 cb && cb()
//             });
//         }
//     });
// };

module.exports.initTemplate = function (clinicId) {
    app.models.template.find({
        where: {
            and: [
                { clinicId: "" },
                { category: { nlike: 'system' } }
            ]
        }
    }, function (error, result) {
        if (result) {
            var templates = _.map(result, function (item) {
                item.id = null;
                item.clinicId = clinicId;
                item.searchName = item.name.toLowerCase();
                item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
                item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
                return item;
            });

            insertData(templates, app.models.template);
        }
    });
};

module.exports.initCSKCB = function () {
    //xlsxj = require("xlsx-to-json");
    //xlsxj({
    //    input: "D:\\Fami\Doc\CSKCB.xlsx",
    //    output: "D:\\Fami\Doc\cskcb.json"
    //}, function (err, result) {
    //    if (err) {
    //        console.error(err);
    //    } else {
    //        console.error(result);
    //    }
    //});

    readFilehandler.readFile('cskcb.json', function (err, data) {
        if (!err) {
            data = data.replace(data[0], "");
            var cskcb = JSON.parse(data);

            var dataToInsert = _.map(cskcb, function (item) {
                var result = {
                    category: "coSoKhamBenh",
                    name: item.ten_bv,
                    address: item.dia_chi,
                    code: item.ma_bv,
                    isActive: true,
                    clinicId: "",
                    districtCode: item.ma_huyen,
                    tuyenBV: item.tuyen_bv,
                    hangBV: item.hang_bv,
                    note: item.ghichu
                };
                result.searchCode = item.ma_bv.toLowerCase();
                var removedDiacriticName = module.exports.removeDiacritics(item.ten_bv ? item.ten_bv.toLowerCase() : "");
                result.searchWithoutDiacritics = removedDiacriticName;
                result.searchEnglishName = item.ten_bv ? item.ten_bv.replace(',', "") : "";

                // add search keywords
                result.searchKeywords = [item.ma_bv, item.ten_bv, removedDiacriticName ? removedDiacriticName : ''];

                return result;
            });

            console.log("cskcb...", dataToInsert);
            insertData(dataToInsert, app.models.SysCfg);
        }
    });
};

// module.exports.initService = function (serviceTypeId, groupServiceId, clinicID) {
//     var service = app.models.Service;
//     service.find({
//         where: {
//             clinicId: ""
//         }
//     }, function (error, result) {
//         if (result) {
//             var services = _.map(result, function (item) {
//                 item.id = null;
//                 item.clinicId = clinicID ? clinicID : "";
//                 item.searchName = item.name.toLowerCase();
//                 item.searchWithoutDiacritics = module.exports.removeDiacritics(item.name).toLowerCase();
//                 item.searchKeywords = _.uniq([item.name, module.exports.removeDiacritics(item.name).toLowerCase()]);
//                 item.typeId = serviceTypeId;
//                 item.groupId = groupServiceId;
//                 return item;
//             });

//             insertData(services, service);
//         }
//     });
// };


// INIT DATA
// module.exports.initHocHam();
// module.exports.initHocVi();
// module.exports.initChuyenMon();
// module.exports.initDescribedResults();
// module.exports.initBSGD();
// module.exports.initRole();
// module.exports.initNhomDichVu();
// module.exports.initBank();


// module.exports.initSpecialization();
// module.exports.initDepartment();
//module.exports.initPatientGroup();
// module.exports.initMedicine();
//module.exports.initDuocChatChinh();
// module.exports.initUnitMedicine();
//module.exports.initPrescription();
// module.exports.initCachDung();
// module.exports.initReportTemplate();
// module.exports.initAdvised();
//module.exports.initTrieuChung();
// module.exports.initICD10();
//module.exports.initThongTinThamVan();
//module.exports.initBodyParts();
//module.exports.initChungNgua();
//module.exports.initTamSoat();
//module.exports.initVanDeBT();
//module.exports.initVanDeXH();
//module.exports.initRelation();
// module.exports.initBoXN();
//module.exports.initServicePackage();
// module.exports.initGroupService();
// module.exports.initServiceType();
//module.exports.initMucBHYT();
//module.exports.initDTBH();
//module.exports.initCoSoKhamBenh();
// module.exports.initCDHA();
//module.exports.initUnitTest();
// module.exports.initParameter();
// module.exports.initTest();
//module.exports.initDescribedResults();
//module.exports.initGoiXetNghiemMau();
//module.exports.initTemplate();

//module.exports.initCSKCB();


// Utility functions
module.exports.toTitleCase = function (str) {
    return str.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
}

module.exports.createLog = function (modelName, createdById, level, action, event, clinicId) {
    return {
        model: modelName,
        action: action,
        'event': event,
        createdById: createdById,
        level: level,
        clinicId: clinicId
    }
}
