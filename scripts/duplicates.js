const axios = require("axios")
const fs = require("fs")

async function duplicates() {
    const userList = JSON.parse(
        fs.readFileSync("/home/mikey/flashLoanV3/users/users1.json", "utf8")
    )
    let newArr1 = makeSmallArray(userList["137"])
    let newArr2 = makeSmallArray(userList["31337"])
    userList["137"] = newArr1
    userList["31337"] = newArr2
    fs.writeFileSync("/home/mikey/flashLoanV3/users/users1.json", JSON.stringify(userList))
}

function makeSmallArray(arr) {
    var smallArr = []
    for (let i = 0; i < arr.length; i++) {
        if (!smallArr.includes(arr[i].toLowerCase())) {
            smallArr.push(arr[i].toLowerCase())
        }
    }
    return smallArr
}

function removeDuplicates(arr) {
    var result = []
    var smallArr = makeSmallArray(arr)
    for (let i = 0; i < arr.length; i++) {
        if (smallArr[i] == arr[i].toLowerCase()) {
            result.push(arr[i])
        }
    }
    return result
}

duplicates()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
