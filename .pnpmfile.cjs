// Package metadata only; local installs keep their workspace development scripts.
module.exports = {
  hooks: {
    beforePacking(pkg) {
      if (
        ![
          '@tandryio/hub',
          '@tandryio/protocol',
          '@tandryio/web',
          '@tandryio/claude',
          '@tandryio/codex',
          '@tandryio/pi',
          '@tandryio/opencode',
          '@tandryio/dsh',
        ].includes(pkg.name)
      )
        return pkg;
      if (['@tandryio/claude', '@tandryio/codex', '@tandryio/pi', '@tandryio/opencode', '@tandryio/dsh'].includes(pkg.name)) {
        delete pkg.dependencies;
        delete pkg.private;
      }
      delete pkg.scripts;
      delete pkg.devDependencies;
      return pkg;
    },
  },
};
