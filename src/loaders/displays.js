import DataLoader from 'dataloader';
import request from 'superagent';

export default () => {
  const vncDisplays = new DataLoader(async urls => {
    const displays = await Promise.all(urls.map(url => request.get(url)));

    return displays.map(({ body }) => body);
  });

  return {
    vncDisplays,
  };
};
