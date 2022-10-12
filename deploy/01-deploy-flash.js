const { network, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../helper-hardhat-config")
require("dotenv").config()
const { verify } = require("../utils/verify")

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    const PROVIDER = networkConfig[chainId].lendingPoolAddressesProvider
    const SWAP_ROUTER = networkConfig[chainId].swapRouter
    const args = [PROVIDER, SWAP_ROUTER]

    log("Deploying flasher...")
    const flash = await deploy("Flash", {
        from: deployer,
        log: true,
        args: args,
        waitConfirmations: network.config.blockConfirmations || 1,
    })

    if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        log("Verifying...")
        await verify(flash.address, args)
    }

    log("------------------------------------")
}

module.exports.tags = ["all"]
