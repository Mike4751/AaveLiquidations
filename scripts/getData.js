const { ethers, getNamedAccounts, network } = require("hardhat")
const { developmentChains, networkConfig, ALCHEMY_API_KEY } = require("../helper-hardhat-config")
const { Network, Alchemy, parseEther } = require("alchemy-sdk")
const { Pool } = require("@uniswap/v3-sdk")
const axios = require("axios")
const fs = require("fs")

// const USER_LIST = "/home/mikey/flashLoanV3/users/users.json"
const USER_LIST = "/home/mikey/flashLoanV3/users/users1.json"
const TOKEN_ADDRESSES = "/home/mikey/flashLoanV3/users/tokenAddresses.json"

async function main() {
    while (true) {
        const chainId = network.config.chainId
        const chains = ["137", "31337"]
        const { deployer } = await getNamedAccounts()
        const poolAddressesProvider = await ethers.getContractAt(
            "IPoolAddressesProvider",
            networkConfig[chainId].lendingPoolAddressesProvider,
            deployer
        )
        const poolAddress = await poolAddressesProvider.getPool()
        console.log(poolAddress.toString())
        const pool = await ethers.getContractAt("IPool", poolAddress, deployer)

        const users = JSON.parse(fs.readFileSync(USER_LIST, "utf8"))
        let debtData
        for (let j = 0; j < chains.length; j++) {
            for (let i = 0; i < users[chains[j]].length; i++) {
                let address = users[chains[j]][i]
                let HF
                try {
                    let accountData = await pool.getUserAccountData(address)
                    let eModeEnabled = await pool.getUserEMode(address)
                    let eMode = eModeEnabled.toNumber()
                    HF = accountData[5].toString() / 10 ** 18
                    if (HF < 1) {
                        debtData = await getDebt(address, HF, eMode)
                        console.log(debtData)
                        let aTokens = 0
                        for (let x in debtData) {
                            for (let y in debtData[x]) {
                                if (aTokens < debtData[x][y]["aTokens"]) {
                                    aTokens = debtData[x][y]["aTokens"]
                                }
                            }
                        }
                        if (aTokens == 0) {
                            continue
                        }
                        await calculateProfit(debtData, address)
                    }
                } catch (error) {
                    console.log(error)
                } finally {
                    continue
                }
            }
        }
        console.log("Finished the list going back around")
    }
}

async function getDebt(user, HF, eMode) {
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    const poolAddressesProvider = await ethers.getContractAt(
        "IPoolAddressesProvider",
        networkConfig[chainId].lendingPoolAddressesProvider,
        deployer
    )
    const providerAddress = await poolAddressesProvider.getPoolDataProvider()
    const dataProvider = await ethers.getContractAt(
        "AaveProtocolDataProvider",
        providerAddress,
        deployer
    )
    let data = []
    let tokenSymbols = []
    let debtToCover
    const tokens = await dataProvider.getAllReservesTokens()
    for (let i = 0; i < tokens.length; i++) {
        let tokenSymbol = tokens[i][0]
        let tokenAddress = tokens[i][1]
        let userData = await dataProvider.getUserReserveData(tokenAddress, user)
        let reserveData = await dataProvider.getReserveConfigurationData(tokenAddress)
        let liqProtFee = await dataProvider.getLiquidationProtocolFee(tokenAddress)
        let decimals = reserveData[0].toString()
        let aTokenBalance = userData[0].toString() / 10 ** decimals
        let stableDebt = userData[1].toString() / 10 ** decimals
        let variableDebt = userData[2].toString() / 10 ** decimals
        let usageAsCollateral = userData[8].toString()
        let collatStat = reserveData[5].toString()
        let lqBonus
        if (eMode == 1) {
            lqBonus = 1.01
        } else {
            lqBonus = reserveData[3].toString() / 10000
        }

        if (HF > 0.95) {
            debtToCover = (stableDebt + variableDebt) * 0.5
        } else {
            debtToCover = stableDebt + variableDebt
        }
        if (aTokenBalance > 0 || stableDebt > 0 || variableDebt > 0) {
            let a = {}
            a[tokenSymbol] = {
                aTokens: aTokenBalance,
                tokenAddress: tokenAddress,
                stableDebt: stableDebt,
                variableDebt: variableDebt,
                debtToCover: debtToCover,
                collatStat: collatStat,
                liqProtFee: liqProtFee.toNumber() / 10000,
                lqBonus: lqBonus,
                decimals: decimals,
                usageAsCollateral: usageAsCollateral,
                HF: HF,
            }
            tokenSymbols.push(tokenSymbol)
            data.push(a)
            // console.log(data)
        }
    }
    data.push(tokenSymbols)
    return data
}

async function calculateProfit(data, user) {
    console.log(user)
    const chainId = network.config.chainId
    const { deployer } = await getNamedAccounts()
    const poolAddressesProvider = await ethers.getContractAt(
        "IPoolAddressesProvider",
        networkConfig[chainId].lendingPoolAddressesProvider,
        deployer
    )
    const oracleAddress = await poolAddressesProvider.getPriceOracle()
    const oracle = await ethers.getContractAt("AaveOracle", oracleAddress, deployer)
    const tokens = data[data.length - 1]
    console.log(tokens)
    let aTokens = 0
    let debtToCover = 0
    let collateralToken
    let collateralAddress
    let collateralDecimals
    let debtToken
    let debtAddress
    let debtDecimals
    let liquidationBonus
    let assetPrice
    for (let i = 0; i < tokens.length; i++) {
        assetPrice = (await oracle.getAssetPrice(data[i][tokens[i]]["tokenAddress"])) / 10 ** 8
        if (
            aTokens < data[i][tokens[i]]["aTokens"] * assetPrice &&
            data[i][tokens[i]]["usageAsCollateral"] == "true"
        ) {
            aTokens = data[i][tokens[i]]["aTokens"] * assetPrice
            collateralToken = tokens[i]
            collateralAddress = data[i][tokens[i]]["tokenAddress"]
            collateralDecimals = data[i][tokens[i]]["decimals"]
            liquidationBonus = data[i][tokens[i]]["lqBonus"]
        }
    }
    for (let i = 0; i < tokens.length; i++) {
        assetPrice = (await oracle.getAssetPrice(data[i][tokens[i]]["tokenAddress"])) / 10 ** 8
        if (
            debtToCover < data[i][tokens[i]]["debtToCover"] * assetPrice &&
            collateralToken != tokens[i]
        ) {
            debtToCover = data[i][tokens[i]]["debtToCover"] * assetPrice
            debtToken = tokens[i]
            debtAddress = data[i][tokens[i]]["tokenAddress"]
            debtDecimals = data[i][tokens[i]]["decimals"]
        }
    }
    const debtAssetPrice = (await oracle.getAssetPrice(debtAddress)) / 10 ** 8
    const collateralPrice = (await oracle.getAssetPrice(collateralAddress)) / 10 ** 8
    debtToCover = debtToCover / debtAssetPrice

    console.log(`Collateral Token: ${collateralToken}`)
    console.log(`Collateral Address: ${collateralAddress}`)
    console.log(`Collateral Decimals: ${collateralDecimals}`)
    console.log(`Debt Token: ${debtToken}`)
    console.log(`Debt To Cover: ${debtToCover}`)
    console.log(`Debt Address: ${debtAddress}`)
    console.log(`Debt Decimals: ${debtDecimals}`)
    console.log(`Liquidation Bonus: ${liquidationBonus}`)

    const maticPrice =
        (await oracle.getAssetPrice("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270")) / 10 ** 8
    const collateralAssetPriceMatic = collateralPrice / maticPrice

    console.log(`Debt Price: $${debtAssetPrice}`)
    console.log(`Collateral Price $${collateralPrice}`)

    const maxAmountOfCollateralToLiquidate =
        (debtAssetPrice * debtToCover * liquidationBonus) / collateralPrice

    const maxCollateralReceivedMatic =
        maxAmountOfCollateralToLiquidate * (liquidationBonus - 1) * collateralAssetPriceMatic
    // liquidationBonus
    const maxCollateralReceived = maxAmountOfCollateralToLiquidate * (liquidationBonus - 1) //* collateralPrice // / liquidationBonus

    console.log(
        `Max Amount of Collateral to Liquidate ${maxAmountOfCollateralToLiquidate} ${collateralToken}`
    )
    console.log(`Max Amount of Collateral to Receive in Matic: ${maxCollateralReceivedMatic} Matic`)
    console.log(
        `Max Amount of Collateral to Receive in ${collateralToken}: ${maxCollateralReceived} ${collateralToken}`
    )
    const flash = await ethers.getContract("Flash", deployer)
    console.log("FlashAddress", flash.address)
    let poolFee1 = await checkPool(
        collateralAddress,
        debtAddress,
        debtToCover,
        maxAmountOfCollateralToLiquidate,
        debtToken,
        collateralToken
    )
    let usePath = false
    let poolFeeCollateral = 0
    let poolFeeDebt = 0
    let pathToken = "0x0000000000000000000000000000000000000000"
    if (poolFee1 == undefined) {
        usePath = true
        let poolFeeData = await checkMultiPool(
            collateralAddress,
            debtAddress,
            networkConfig[chainId].wMaticAddress
        )
        console.log(poolFeeData["pathToken"])
        poolFeeDebt = poolFeeData["debt"][0]
        console.log(poolFeeDebt)
        poolFeeCollateral = poolFeeData["collateral"][0]
        console.log(poolFeeCollateral)
        pathToken = poolFeeData["pathToken"][0]
        console.log(pathToken)
    }
    console.log(poolFee1)
    const settings = {
        apiKey: ALCHEMY_API_KEY, // Replace with your Alchemy API Key.
        network: Network.MATIC_MAINNET, // Replace with your network.
    }

    const alchemy = new Alchemy(settings)
    const gasPrice1 = await alchemy.core.getGasPrice()
    const gasPrice2 = ethers.utils.formatUnits(gasPrice1, "gwei") / 1000000000
    console.log(gasPrice2)
    const gasPrice = 700000 * gasPrice2
    console.log(gasPrice)
    const flashFee = (0.0005 * debtToCover * debtAssetPrice) / maticPrice
    let swapFee
    if (poolFeeCollateral != 0) {
        swapFee =
            poolFeeCollateral * maxAmountOfCollateralToLiquidate * collateralAssetPriceMatic +
            poolFeeDebt * debtToCover * collateralAssetPriceMatic
    } else {
        swapFee = poolFee1 * maxAmountOfCollateralToLiquidate * collateralAssetPriceMatic
    }
    if (collateralToken == debtToken) {
        profit = maxCollateralReceivedMatic - flashFee - gasPrice
    } else {
        profit = maxCollateralReceivedMatic - flashFee - swapFee - gasPrice
    }
    console.log(profit)
    console.log(debtToCover.toString())
    if (profit > 0) {
        if (debtToken == collateralToken) {
            console.log(ethers.utils.parseEther(debtToCover.toFixed(debtDecimals)).toString())
            const flashLoan = await flash.myFlashLoan(
                debtAddress,
                ethers.utils.parseEther(debtToCover.toString()),
                collateralAddress,
                user,
                debtDecimals,
                0,
                0,
                pathToken,
                usePath
            )
            await flashLoan.wait(1)
            console.log("I think they got liquidated")
            const liquidList = JSON.parse(
                fs.readFileSync("/home/mikey/flashLoanV3/liquidations/liquidations.json", "utf8")
            )
            liquidList[chainId].push({
                collateralToken: collateralToken,
                debtToken: debtToken,
                debtToCover: debtToCover,
                maxCollateralReceivedMatic: maxCollateralReceivedMatic,
                profit: profit,
            })
            fs.writeFileSync(
                "/home/mikey/flashLoanV3/liquidations/liquidations.json",
                JSON.stringify(liquidList)
            )
        } else {
            console.log(ethers.utils.parseEther(debtToCover.toFixed(debtDecimals)).toString())
            if (poolFeeCollateral == 0) {
                const flashLoan = await flash.myFlashLoan(
                    debtAddress,
                    ethers.utils.parseEther(debtToCover.toString()),
                    collateralAddress,
                    user,
                    debtDecimals,
                    poolFee1 * 10 ** 6,
                    poolFeeCollateral * 10 ** 6,
                    pathToken,
                    usePath
                )
                await flashLoan.wait(1)
                console.log("I think they got liquidated")
                const liquidList = JSON.parse(
                    fs.readFileSync(
                        "/home/mikey/flashLoanV3/liquidations/liquidations.json",
                        "utf8"
                    )
                )
                liquidList[chainId].push({
                    collateralToken: collateralToken,
                    debtToken: debtToken,
                    debtToCover: debtToCover,
                    maxCollateralReceivedMatic: maxCollateralReceivedMatic,
                    profit: profit,
                })
                fs.writeFileSync(
                    "/home/mikey/flashLoanV3/liquidations/liquidations.json",
                    JSON.stringify(liquidList)
                )
            } else {
                const flashLoan = await flash.myFlashLoan(
                    debtAddress,
                    ethers.utils.parseEther(debtToCover.toString()),
                    collateralAddress,
                    user,
                    debtDecimals,
                    poolFeeDebt * 10 ** 6,
                    poolFeeCollateral * 10 ** 6,
                    pathToken,
                    usePath
                )
                await flashLoan.wait(1)
                console.log("I think they got liquidated")
                const liquidList = JSON.parse(
                    fs.readFileSync(
                        "/home/mikey/flashLoanV3/liquidations/liquidations.json",
                        "utf8"
                    )
                )
                liquidList[chainId].push({
                    collateralToken: collateralToken,
                    debtToken: debtToken,
                    debtToCover: debtToCover,
                    maxCollateralReceivedMatic: maxCollateralReceivedMatic,
                    profit: profit,
                })
                fs.writeFileSync(
                    "/home/mikey/flashLoanV3/liquidations/liquidations.json",
                    JSON.stringify(liquidList)
                )
            }
        }
    }
}

async function checkPool(
    collateralAddress,
    debtAddress,
    debtToCover,
    maxAmountOfCollateralToLiquidate,
    debtToken,
    collateralToken
) {
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    const swapPoolFactory = await ethers.getContractAt(
        "IUniswapV3Factory",
        networkConfig[chainId].swapPoolFactory,
        deployer
    )
    const json = JSON.parse(
        fs.readFileSync(
            "/home/mikey/flashLoanV3/node_modules/@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json",
            "utf8"
        )
    )
    const abi = json.abi
    const URL = "https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon"
    let poolFees
    if (
        (debtToken == "WMATIC" && collateralToken == "WETH") ||
        (debtToken == "WMATIC" && collateralToken == "USDC") ||
        (debtToken == "WETH" && collateralToken == "USDC")
    ) {
        poolFees = [0.0005, 0.003, 0.01]
    } else if (
        (debtToken == "WETH" && collateralToken == "WMATIC") ||
        (debtToken == "USDC" && collateralToken == "WMATIC") ||
        (debtToken == "USDC" && collateralToken == "WETH")
    ) {
        poolFees = [0.0005, 0.003, 0.01]
    } else {
        poolFees = [0.003, 0.01]
    }
    for (let i = 0; i < poolFees.length; i++) {
        let swapPoolAddress = await swapPoolFactory.getPool(
            collateralAddress,
            debtAddress,
            poolFees[i] * 10 ** 6
        )
        console.log(swapPoolAddress.toString())
        if (swapPoolAddress.toString() != "0x0000000000000000000000000000000000000000") {
            // swapPool = new ethers.Contract(swapPoolAddress.toString(), abi, deployer)
            console.log(swapPoolAddress.toString())
            try {
                const result = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${swapPoolAddress.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                // console.log(result.data.data.pool)
                let poolData = result.data.data.pool
                let token0 = poolData.token0.symbol
                let token1 = poolData.token1.symbol
                let totalValueLockedToken0 = poolData.totalValueLockedToken0
                let totalValueLockedToken1 = poolData.totalValueLockedToken1
                console.log(`Token: ${token0} TVL: ${totalValueLockedToken0}`)
                console.log(`Token: ${token1} TVL: ${totalValueLockedToken1}`)
                if (debtToken == token0) {
                    if (
                        debtToCover < totalValueLockedToken0 &&
                        maxAmountOfCollateralToLiquidate < totalValueLockedToken1
                    ) {
                        console.log(poolFees[i])
                        return poolFees[i]
                    }
                } else if (debtToken == token1) {
                    if (
                        debtToCover < totalValueLockedToken1 &&
                        maxAmountOfCollateralToLiquidate < totalValueLockedToken0
                    ) {
                        console.log(poolFees[i])
                        return poolFees[i]
                    }
                }
            } catch (error) {
                console.error(error)
            }
        }
    }
}

async function checkMultiPool(collateralAddress, debtAddress, wMaticAddress) {
    const WETHAddress = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"
    const USDCAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    const swapPoolFactory = await ethers.getContractAt(
        "IUniswapV3Factory",
        networkConfig[chainId].swapPoolFactory,
        deployer
    )
    const URL = "https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon"
    const poolFees = [0.0001, 0.0005, 0.003, 0.01]
    let multihopPoolData = { pathToken: [], debt: [], collateral: [] }
    // MATIC Check
    for (let i = 0; i < poolFees.length; i++) {
        let debtMatic = await swapPoolFactory.getPool(
            wMaticAddress,
            debtAddress,
            poolFees[i] * 10 ** 6
        )
        let collateralMatic = await swapPoolFactory.getPool(
            wMaticAddress,
            collateralAddress,
            poolFees[i] * 10 ** 6
        )
        if (
            debtMatic.toString() != "0x0000000000000000000000000000000000000000" &&
            collateralMatic.toString() != "0x0000000000000000000000000000000000000000"
        ) {
            try {
                const debtMaticResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${debtMatic.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                const collateralMaticResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${collateralMatic.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                // console.log(result.data.data.pool)
                let debtMaticPoolData = debtMaticResult.data.data.pool
                let debtMaticToken0 = debtMaticPoolData.token0.symbol
                let debtMaticToken1 = debtMaticPoolData.token1.symbol
                let debtMaticTotalValueLockedToken0 = debtMaticPoolData.totalValueLockedToken0
                let debtMaticTotalValueLockedToken1 = debtMaticPoolData.totalValueLockedToken1
                console.log(`Token: ${debtMaticToken0} TVL: ${debtMaticTotalValueLockedToken0}`)
                console.log(`Token: ${debtMaticToken1} TVL: ${debtMaticTotalValueLockedToken1}`)
                if (
                    debtMaticTotalValueLockedToken0 > 2000 &&
                    debtMaticTotalValueLockedToken1 > 2000
                ) {
                    multihopPoolData["debt"].push(poolFees[i])
                }
                let collateralMaticPoolData = collateralMaticResult.data.data.pool
                let collateralMaticToken0 = collateralMaticPoolData.token0.symbol
                let collateralMaticToken1 = collateralMaticPoolData.token1.symbol
                let collateralMaticTotalValueLockedToken0 =
                    collateralMaticPoolData.totalValueLockedToken0
                let collateralMaticTotalValueLockedToken1 =
                    collateralMaticPoolData.totalValueLockedToken1
                console.log(
                    `Token: ${collateralMaticToken0} TVL: ${collateralMaticTotalValueLockedToken0}`
                )
                console.log(
                    `Token: ${collateralMaticToken1} TVL: ${collateralMaticTotalValueLockedToken1}`
                )
                console.log(multihopPoolData)
                if (
                    collateralMaticTotalValueLockedToken0 > "2000" &&
                    collateralMaticTotalValueLockedToken1 > "2000"
                ) {
                    multihopPoolData["collateral"].push(poolFees[i])
                }
                if (
                    multihopPoolData["debt"].length > 0 &&
                    multihopPoolData["collateral"].length > 0
                ) {
                    multihopPoolData["pathToken"].push(wMaticAddress)
                    console.log(multihopPoolData)
                    return multihopPoolData
                }
            } catch (error) {
                console.error(error)
            }
        }
    }
    multihopPoolData = { pathToken: [], debt: [], collateral: [] }
    for (let i = 0; i < poolFees.length; i++) {
        let debtWETH = await swapPoolFactory.getPool(
            WETHAddress,
            debtAddress,
            poolFees[i] * 10 ** 6
        )
        let collateralWETH = await swapPoolFactory.getPool(
            WETHAddress,
            collateralAddress,
            poolFees[i] * 10 ** 6
        )
        if (
            debtWETH.toString() != "0x0000000000000000000000000000000000000000" &&
            collateralWETH.toString() != "0x0000000000000000000000000000000000000000"
        ) {
            try {
                const debtWETHResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${debtWETH.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                const collateralWETHResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${collateralWETH.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                // console.log(result.data.data.pool)
                let debtWETHPoolData = debtWETHResult.data.data.pool
                let debtWETHToken0 = debtWETHPoolData.token0.symbol
                let debtWETHToken1 = debtWETHPoolData.token1.symbol
                let debtWETHTotalValueLockedToken0 = debtWETHPoolData.totalValueLockedToken0
                let debtWETHTotalValueLockedToken1 = debtWETHPoolData.totalValueLockedToken1
                console.log(`Token: ${debtWETHToken0} TVL: ${debtWETHTotalValueLockedToken0}`)
                console.log(`Token: ${debtWETHToken1} TVL: ${debtWETHTotalValueLockedToken1}`)
                if (debtWETHToken0 == "WETH") {
                    if (
                        debtWETHTotalValueLockedToken0 > 2 &&
                        debtWETHTotalValueLockedToken1 > 2000
                    ) {
                        multihopPoolData["debt"].push(poolFees[i])
                    }
                } else {
                    if (
                        debtWETHTotalValueLockedToken0 > 2000 &&
                        debtWETHTotalValueLockedToken1 > 2
                    ) {
                        multihopPoolData["debt"].push(poolFees[i])
                    }
                }
                let collateralWETHPoolData = collateralWETHResult.data.data.pool
                let collateralWETHToken0 = collateralWETHPoolData.token0.symbol
                let collateralWETHToken1 = collateralWETHPoolData.token1.symbol
                let collateralWETHTotalValueLockedToken0 =
                    collateralWETHPoolData.totalValueLockedToken0
                let collateralWETHTotalValueLockedToken1 =
                    collateralWETHPoolData.totalValueLockedToken1
                console.log(
                    `Token: ${collateralWETHToken0} TVL: ${collateralWETHTotalValueLockedToken0}`
                )
                console.log(
                    `Token: ${collateralWETHToken1} TVL: ${collateralWETHTotalValueLockedToken1}`
                )
                console.log(multihopPoolData)
                if (collateralWETHToken0 == "WETH") {
                    if (
                        collateralWETHTotalValueLockedToken0 > "2" &&
                        collateralWETHTotalValueLockedToken1 > "2000"
                    ) {
                        multihopPoolData["collateral"].push(poolFees[i])
                    }
                } else {
                    if (
                        collateralWETHTotalValueLockedToken0 > "2000" &&
                        collateralWETHTotalValueLockedToken1 > "2"
                    ) {
                        multihopPoolData["collateral"].push(poolFees[i])
                    }
                }
                if (
                    multihopPoolData["debt"].length > 0 &&
                    multihopPoolData["collateral"].length > 0
                ) {
                    multihopPoolData["pathToken"].push(WETHAddress)
                    console.log(multihopPoolData)
                    return multihopPoolData
                }
            } catch (error) {
                console.error(error)
            }
        }
    }
    multihopPoolData = { pathToken: [], debt: [], collateral: [] }
    for (let i = 0; i < poolFees.length; i++) {
        let debtUSDC = await swapPoolFactory.getPool(
            USDCAddress,
            debtAddress,
            poolFees[i] * 10 ** 6
        )
        let collateralUSDC = await swapPoolFactory.getPool(
            USDCAddress,
            collateralAddress,
            poolFees[i] * 10 ** 6
        )
        if (
            debtUSDC.toString() != "0x0000000000000000000000000000000000000000" &&
            collateralUSDC.toString() != "0x0000000000000000000000000000000000000000"
        ) {
            try {
                const debtUSDCResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${debtUSDC.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                const collateralUSDCResult = await axios.post(URL, {
                    query: `
                    {
                    pool(id: "${collateralUSDC.toString().toLowerCase()}"){
                        liquidity
                        token0{
                            symbol
                        }
                        totalValueLockedToken0
                        token1{
                            symbol
                        }
                        totalValueLockedToken1
                    }
                }
                `,
                })
                // console.log(result.data.data.pool)
                let debtUSDCPoolData = debtUSDCResult.data.data.pool
                let debtUSDCToken0 = debtUSDCPoolData.token0.symbol
                let debtUSDCToken1 = debtUSDCPoolData.token1.symbol
                let debtUSDCTotalValueLockedToken0 = debtUSDCPoolData.totalValueLockedToken0
                let debtUSDCTotalValueLockedToken1 = debtUSDCPoolData.totalValueLockedToken1
                console.log(`Token: ${debtUSDCToken0} TVL: ${debtUSDCTotalValueLockedToken0}`)
                console.log(`Token: ${debtUSDCToken1} TVL: ${debtUSDCTotalValueLockedToken1}`)
                if (
                    debtUSDCTotalValueLockedToken0 > 2000 &&
                    debtUSDCTotalValueLockedToken1 > 2000
                ) {
                    multihopPoolData["debt"].push(poolFees[i])
                    console.log(multihopPoolData)
                }
                let collateralUSDCPoolData = collateralUSDCResult.data.data.pool
                let collateralUSDCToken0 = collateralUSDCPoolData.token0.symbol
                let collateralUSDCToken1 = collateralUSDCPoolData.token1.symbol
                let collateralUSDCTotalValueLockedToken0 =
                    collateralUSDCPoolData.totalValueLockedToken0
                let collateralUSDCTotalValueLockedToken1 =
                    collateralUSDCPoolData.totalValueLockedToken1
                console.log(
                    `Token: ${collateralUSDCToken0} TVL: ${collateralUSDCTotalValueLockedToken0}`
                )
                console.log(
                    `Token: ${collateralUSDCToken1} TVL: ${collateralUSDCTotalValueLockedToken1}`
                )
                console.log(multihopPoolData)
                if (
                    collateralUSDCTotalValueLockedToken0 > "2000" &&
                    collateralUSDCTotalValueLockedToken1 > "2000"
                ) {
                    multihopPoolData["collateral"].push(poolFees[i])
                }
                if (
                    multihopPoolData["debt"].length > 0 &&
                    multihopPoolData["collateral"].length > 0
                ) {
                    multihopPoolData["pathToken"].push(USDCAddress)
                    console.log(multihopPoolData)
                    return multihopPoolData
                }
                console.log(multihopPoolData)
            } catch (error) {
                console.error(error)
            }
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
