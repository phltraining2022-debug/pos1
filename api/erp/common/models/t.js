const slugify = require('./slugify');

// Input string
const inputString = "tiếng việt";

// Generate slug
const slug = slugify(inputString, {
  replacement: '-',   // Replace spaces with '-'
  lower: true         // Convert to lowercase
});

console.log(slug);    // Output: tieng-viet

