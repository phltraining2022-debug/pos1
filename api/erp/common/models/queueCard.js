module.exports = function(Card) {
    Card.validatesUniquenessOf('visitId', { message: 'Visit  is not unique' });
};
