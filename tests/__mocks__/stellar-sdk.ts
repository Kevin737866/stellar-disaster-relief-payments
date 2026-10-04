export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};

export const Keypair = {
  fromSecret: jest.fn().mockReturnValue({
    publicKey: () => 'GABC123MOCKPUBLICKEY',
    sign: jest.fn(),
  }),
  random: jest.fn().mockReturnValue({
    publicKey: () => 'GABC123MOCKPUBLICKEY',
    secret: () => 'SABC123MOCKSECRETKEY',
    sign: jest.fn(),
  }),
};

export const Address = jest.fn().mockImplementation((address: string) => ({
  toScVal: () => ({ type: 'Address', value: address }),
}));

export const nativeToScVal = jest.fn().mockImplementation((val: any) => ({
  type: 'Native',
  value: val,
}));

export const scValToNative = jest.fn().mockImplementation((val: any) => val?.value ?? val);

const mockSendTransaction = jest.fn().mockResolvedValue({
  status: 'SUCCESS',
  result: { retval: { value: true } },
});

const mockGetAccount = jest.fn().mockResolvedValue({
  accountId: () => 'GABC123MOCKPUBLICKEY',
  sequenceNumber: () => '1234567890',
  incrementSequenceNumber: jest.fn(),
});

export const Server = jest.fn().mockImplementation(() => ({
  getAccount: mockGetAccount,
  sendTransaction: mockSendTransaction,
}));

const mockContractCall = jest.fn().mockResolvedValue({
  result: { retval: { value: [] } },
});

export const Contract = jest.fn().mockImplementation(() => ({
  call: jest.fn().mockReturnValue({ type: 'operation' }),
}));

export const TransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({
    sign: jest.fn(),
  }),
}));
