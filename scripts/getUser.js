const { Network, Alchemy } = require("alchemy-sdk")
const fs = require("fs")
const { Interface } = require("ethers/lib/utils")

let user
const users = []
const settings = {
    apiKey: "uBTNnSx0ENqa2KLvoEkHukst8ShVYs6u",
    network: Network.MATIC_MAINNET,
}
const alchemy = new Alchemy(settings)
const borrowTopic = "0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0"

const borrowEvent = {
    address: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    topics: [borrowTopic],
}

const pullingUser = async (txn) => {
    const json = JSON.parse(
        fs.readFileSync(
            "/home/mikey/flashLoanV3/artifacts/@aave/core-v3/contracts/interfaces/IPool.sol/IPool.json",
            "utf8"
        )
    )
    const abi = json.abi
    const iface = new Interface(abi)
    const data = txn.data
    const topics = txn.topics
    user = iface.parseLog({ data, topics })
    console.log(`User: ${user.args[1]}`)
    users.push(user.args[1])
    const userList1 = JSON.parse(
        fs.readFileSync("/home/mikey/flashLoanV3/users/users1.json", "utf8")
    )
    console.log(userList1["137"].length)
    if (!userList1["137"].includes(user.args[1].toLowerCase())) {
        userList1["137"].push(user.args[1].toLowerCase())
        console.log("User added to da list")
    }

    fs.writeFileSync("/home/mikey/flashLoanV3/users/users1.json", JSON.stringify(userList1))
}

alchemy.ws.on(borrowEvent, pullingUser)
