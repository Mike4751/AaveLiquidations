require("dotenv").config()

const networkConfig = {
    31337: {
        name: "localhost",
        lendingPoolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        swapPoolFactory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        wMaticAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    },
    // Price Feed Address, values can be obtained at https://docs.chain.link/docs/reference-contracts
    // Default one is ETH/USD contract on Kovan
    80001: {
        name: "mumbai",
        lendingPoolAddressesProvider: "0x5343b5bA672Ae99d627A1C87866b8E53F47Db2E6",
        swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        swapPoolFactory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        wMaticAddress: "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889",
    },
    137: {
        name: "polygon",
        lendingPoolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        swapPoolFactory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        wMaticAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    },
}

const developmentChains = ["hardhat", "localhost"]

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY

module.exports = {
    networkConfig,
    developmentChains,
    ALCHEMY_API_KEY,
}
