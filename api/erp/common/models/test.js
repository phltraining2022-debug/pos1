module.exports = function(Test) {
    Test.observe('before save', function setCreatedAtAndUpdatedAt(ctx, next) {
        var instance = ctx.instance || ctx.data;
        console.log(instance)

        if (instance.name) {
            instance.searchName = instance.name.toLowerCase();
        }

        if (instance.sampleType === '')
            instance.sampleType = null;
        
        next();
    })
};
