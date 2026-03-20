module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ assets: "assets" });

  return {
    dir: {
      input: "src",
      output: "dist",
    },
  };
};
