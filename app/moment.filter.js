// AngularJS filter for moment.js formatting
angular.module('karaApp').filter('moment', function() {
  return function(input, format) {
    if (!input) return '';
    return moment(input).format(format || 'DD/MM/YYYY');
  };
});
