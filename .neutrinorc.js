module.exports = {
  use: [
    ['neutrino-preset-mozilla-frontend-infra/node', {
      hot: false,
      babel: {
        plugins: [
          require.resolve('babel-plugin-transform-object-rest-spread'),
        ],
      },
      eslint: {
        rules: {
          'no-nested-ternary': 'off',
        },
      },
    }],
    // replace start-server with restart-server
    (neutrino) => {
      neutrino.config.when(neutrino.options.command === 'start', config => {
        config.plugins.delete('start-server');
        neutrino.use(['neutrino-middleware-restart-server', {
          name: 'index.js',
        }]);
      });
    },
    (neutrino) => {
      neutrino.config.module
        .rule('graphql')
          .test(/\.graphql$/)
          .use('raw')
            .loader(require.resolve('raw-loader'));
    },
  ],
};
