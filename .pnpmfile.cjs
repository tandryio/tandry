// Package metadata only; local installs keep their workspace development scripts.
module.exports = {
  hooks: {
    beforePacking(pkg) {
      if (
        ![
          '@tandryio/hub',
          '@tandryio/protocol',
          '@tandryio/website',
          '@tandryio/client-claude',
          '@tandryio/client-codex',
          '@tandryio/client-pi',
          '@tandryio/client-opencode',
          '@tandryio/client-dsh',
        ].includes(pkg.name)
      )
        return pkg;
      if (process.env.CORE_RELEASE_VERSION && ['@tandryio/protocol', '@tandryio/hub', '@tandryio/website'].includes(pkg.name)) {
        const version = process.env.CORE_RELEASE_VERSION;
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid CORE_RELEASE_VERSION');
        pkg.version = version;
        for (const name of Object.keys(pkg.dependencies ?? {}))
          if (['@tandryio/protocol', '@tandryio/hub', '@tandryio/website'].includes(name)) pkg.dependencies[name] = version;
      }
      if (pkg.name.startsWith('@tandryio/client-')) {
        delete pkg.dependencies;
        delete pkg.private;
      }
      delete pkg.scripts;
      delete pkg.devDependencies;
      if (pkg.name === '@tandryio/website') pkg.dependencies = {};
      return pkg;
    },
  },
};
