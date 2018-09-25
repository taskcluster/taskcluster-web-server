export default {
  Query: {
    async vncDisplays(parent, { url }, { loaders }) {
      return loaders.vncDisplays.load(url);
    },
  },
};
