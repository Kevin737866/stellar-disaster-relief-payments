export const createHash = jest.fn().mockImplementation((_algo: string) => {
  let _data = '';
  return {
    update: jest.fn().mockImplementation((data: string) => {
      _data = data;
      return {
        toString: jest.fn().mockImplementation(() => {
          let hash = 0;
          for (let i = 0; i < _data.length; i++) {
            hash = ((hash << 5) - hash + _data.charCodeAt(i)) | 0;
          }
          return Math.abs(hash).toString(16).padStart(64, '0');
        }),
      };
    }),
  };
});

export default { createHash };
