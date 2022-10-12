require("@nomiclabs/hardhat-waffle")
require("hardhat-gas-reporter")
require("@nomiclabs/hardhat-etherscan")
require("dotenv").config()
require("solidity-coverage")
require("hardhat-deploy")
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
/**
 * @type import('hardhat/config').HardhatUserConfig
 */

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || process.env.ALCHEMY_MAINNET_RPC_URL || ""
const MUMBAI_RPC_URL =
    process.env.MUMBAI_RPC_URL || "https://eth-mainnet.alchemyapi.io/v2/your-api-key"
const PRIVATE_KEY =
    process.env.PRIVATE_KEY || "0x11ee3108a03081fe260ecdc106554d09d9d1209bcafd46942b10e02943effc4a"
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || ""
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY

module.exports = {
    defaultNetwork: "hardhat",
    networks: {
        hardhat: {
            chainId: 31337,
            forking: {
                url: POLYGON_RPC_URL,
            },
            gasLimit: 3000000,
            timeout: 200000,
        },
        localhost: {
            chainId: 31337,
            forking: {
                url: POLYGON_RPC_URL,
            },
            gasLimit: 3000000,
            timeout: 200000, // 200 seconds max for running tests
        },
        mumbai: {
            url: MUMBAI_RPC_URL,
            accounts: [PRIVATE_KEY],
            chainId: 80001,
            blockConfirmations: 6,
            timeout: 200000,
        },
        polygon: {
            url: POLYGON_RPC_URL,
            accounts: [PRIVATE_KEY],
            chainId: 137,
            blockConfirmations: 6,
            timeout: 200000,
        },
    },
    solidity: {
        compilers: [
            {
                version: "0.8.10",
            },
            {
                version: "0.6.0",
            },
            {
                version: "0.8.0",
            },
        ],
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
        outputFile: "gas-report.txt",
        noColors: true,
        // coinmarketcap: COINMARKETCAP_API_KEY,
    },
    namedAccounts: {
        deployer: {
            default: 0, // here this will by default take the first account as deployer
            1: 0, // similarly on mainnet it will take the first account as deployer. Note though that depending on how hardhat network are configured, the account 0 on one network can be different than on another
        },
        player: {
            default: 0,
        },
    },
}
