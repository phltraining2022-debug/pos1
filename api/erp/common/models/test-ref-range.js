var ranges = [
  {
    "ageFrom": 0,
    "ageTo": 99,
    "operator": {
      "name": "Less Than",
      "value": "<"
    },
    "lowerRange": 200,
    "rangeName": {
      "name": "Desirable",
      "value": "desirable"
    },
    "male": true,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 0,
    "ageTo": 99,
    "operator": {
      "name": "Within",
      "value": "-"
    },
    "lowerRange": 200,
    "upperRange": 239,
    "rangeName": {
      "name": "Borderline High",
      "value": "borderline high"
    },
    "male": true,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 0,
    "ageTo": 99,
    "operator": {
      "name": "Greater Than",
      "value": ">"
    },
    "upperRange": 240,
    "rangeName": {
      "name": "Risk",
      "value": "risk"
    },
    "male": true,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 0,
    "ageTo": 20,
    "operator": {
      "name": "Greater Than",
      "value": ">"
    },
    "upperRange": 240,
    "rangeName": {
      "name": "Risk - female",
      "value": "risk"
    },
    "male": false,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 0,
    "ageTo": 21,
    "operator": {
      "name": "Greater Than",
      "value": ">"
    },
    "upperRange": 240,
    "rangeName": {
      "name": "Risk - male",
      "value": "risk"
    },
    "male": true,
    "female": false,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 25,
    "ageTo": 99,
    "operator": {
      "name": "Greater Than",
      "value": ">"
    },
    "upperRange": 240,
    "rangeName": {
      "name": "Risk - elder person",
      "value": "risk"
    },
    "male": true,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  },
  {
    "ageFrom": 25,
    "ageTo": 99,
    "rangeName": {
      "name": "Risk - elder person",
      "value": "negative"
    },
    "male": true,
    "female": true,
    "single": true,
    "married": true,
    "unit": "mg/dl"
  } 
]

var p = {
    age: 16,
    gender: 'female',
    martialStatus: 'married'
}

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function isAbnormal(p, result, ranges, mr) {
    if (!mr) mr = [];
    if (!isNumber(result)) {
        result = result.toLowerCase();
    }
    console.log("===============");

    var abnormalNames = ["risk", "positive", "high risk", "moderate risk", "equivocal", "borderline high"]
    
    for(var i=0;i<ranges.length;i++) {
        var r=ranges[i];

        if(r[p.martialStatus] && r[p.gender] && r.ageFrom <= p.age && p.age <= r.ageTo) {
            // console.log(result, Number.isNaN(result));
            if (!isNumber(result)) {
                // for text
                if (r.rangeName.value == result) {
                    mr.push(r)
                    if (abnormalNames.indexOf(r.rangeName.value) > -1) {
                        console.log('abnormal !! patient', p, r, result);
                        return true;
                    }
                    // console.log('match ', r.rangeName.name)
                }
            } else {
                // for number
                // check operator 
                if (r.operator && (r.lowerRange || r.upperRange)) {
                    var e = '';
                    if (e) e = e + ' && '
                    if (r.operator.value == "-") {
                        e = e + '(' + result + ' <= ' + r.upperRange + ') && (' + result + ' >= ' + r.lowerRange + ')';
                    } else {
                        e = e + '(' + result + r.operator.value + (r.lowerRange || r.upperRange) + ')'
                    }
                    if (eval(e)) {
                        // console.log('match ', e, r.rangeName.value, eval(e));
                        mr.push(r)
                        if (abnormalNames.indexOf(r.rangeName.value) > -1) {
                            console.log('abnormal !! patient', p, r, result);
                            return true;
                        }
                    }
                }
            }
        }
        
    }    
    console.log('normal patient', p.age);
    return false;
}


isAbnormal({
    age: 26,
    gender: 'female',
    martialStatus: 'married'
}, "NEGATIVE", ranges)


isAbnormal({
    age: 16,
    gender: 'male',
    martialStatus: 'married'
}, "220.44", ranges)


isAbnormal({
    age: 16,
    gender: 'female',
    martialStatus: 'married'
}, "260", ranges)

isAbnormal({
    age: 26,
    gender: 'female',
    martialStatus: 'married'
}, "260.12", ranges)



