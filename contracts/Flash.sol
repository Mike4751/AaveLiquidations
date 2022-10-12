// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;
pragma abicoder v2;

import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IFlashLoanSimpleReceiver} from "@aave/core-v3/contracts/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {AaveProtocolDataProvider} from "@aave/core-v3/contracts/misc/AaveProtocolDataProvider.sol";
import {AaveOracle} from "@aave/core-v3/contracts/misc/AaveOracle.sol";
import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {TransferHelper} from "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import "hardhat/console.sol";

contract Flash is FlashLoanSimpleReceiverBase, Ownable {
    // Parameters used to initiate _liquidateAndSwap and final transfer to owner
    struct LiquidationParams {
        address collateralAsset;
        address borrowedAsset;
        address user;
        uint256 debtToCover;
        uint24 poolFee1;
        uint24 poolFee2;
        address pathToken;
        bool usePath;
    }

    // Parameters used for liquidation and swap logic
    struct LiquidationCallLocalVars {
        uint256 initFlashBorrowedBalance;
        uint256 diffFlashBorrowedBalance;
        uint256 initCollateralBalance;
        uint256 diffCollateralBalance;
        uint256 flashLoanDebt;
        uint256 soldAmount;
        uint256 remainingTokens;
        uint256 borrowedAssetLeftovers;
    }

    ISwapRouter public immutable swapRouter;

    constructor(IPoolAddressesProvider _addressProvider, ISwapRouter _swapRouter)
        FlashLoanSimpleReceiverBase(_addressProvider)
    {
        swapRouter = ISwapRouter(_swapRouter);
    }

    /**
     * @notice Executes an operation after receiving the flash-borrowed asset
     * @dev Ensure that the contract can return the debt + premium, e.g., has
     *      enough funds to repay and has approved the Pool to pull the total amount
     * @param asset The address of the flash-borrowed asset
     * @param amount The amount of the flash-borrowed asset
     * @param premium The fee of the flash-borrowed asset
     * @param params The byte-encoded params passed when initiating the flashloan
     * @return True if the execution of the operation succeeds, false otherwise
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "CALLER_MUST_BE_LENDING_POOL");

        LiquidationParams memory decodedParams = _decodeParams(params);

        require(asset == decodedParams.borrowedAsset, "INCONSISTENT_PARAMS");
        console.log("Trying to liquidate and swap");
        _liquidateAndSwap(
            decodedParams.collateralAsset,
            decodedParams.borrowedAsset,
            decodedParams.user,
            decodedParams.debtToCover,
            decodedParams.poolFee1,
            decodedParams.poolFee2,
            decodedParams.pathToken,
            decodedParams.usePath,
            amount,
            premium
        );

        return true;
    }

    /**
     * @notice Executes the operation of liquidating the debt position, then swaps the collateral asset back to the flash-borrowed asset.
     * @dev Approval of the Pool contract occurs here.
     * @param collateralAsset The address of the asset to receive from the liquidation.
     * @param borrowedAsset The address of the flash-borrowed asset
     * @param user The address of the user being liquidated
     * @param debtToCover The amount of debt to be liquidated
     * @param poolFee1 The fee associated with the Uniswap Pool
     * @param poolFee2 The fee associated with the Uniswap Pool
     * @param pathToken The token to swap between two other tokens from the Uniswap Pool.
     * @param usePath To decide between a single and multihop swap.     *
     * @param flashBorrowedAmount The amount that was flash-borrowed
     * @param premium The fee for taking out a flash loan
     */
    function _liquidateAndSwap(
        address collateralAsset,
        address borrowedAsset,
        address user,
        uint256 debtToCover,
        uint24 poolFee1,
        uint24 poolFee2,
        address pathToken,
        bool usePath,
        uint256 flashBorrowedAmount,
        uint256 premium
    ) internal {
        // Approve the router to spend the specifed `amountInMaximum` of collateral.
        // In production, you should choose the maximum amount to spend based on oracles or other data sources to acheive a better swap.
        LiquidationCallLocalVars memory vars;

        // Initial Collateral Balance
        vars.initCollateralBalance = IERC20(collateralAsset).balanceOf(address(this));
        console.log("Initial collateral balance", vars.initCollateralBalance);

        // Checking if there's an initial balance of borrowed tokens
        if (collateralAsset != borrowedAsset) {
            vars.initFlashBorrowedBalance = IERC20(borrowedAsset).balanceOf(address(this));
            console.log("Initial flash loan borrowed balance", vars.initFlashBorrowedBalance);
            vars.borrowedAssetLeftovers = vars.initFlashBorrowedBalance - flashBorrowedAmount;
            console.log("Borrowed asset leftovers", vars.borrowedAssetLeftovers);
        }

        // Calculating amount to go back to Aave Pool
        vars.flashLoanDebt = flashBorrowedAmount + premium;
        console.log("flashLoan debt", vars.flashLoanDebt);
        console.log("Approving liquidation");

        // Approving the pool to liquidate the debt position
        require(IERC20(borrowedAsset).approve(address(POOL), debtToCover), "Approval error");
        console.log("Liquidating");
        console.log(debtToCover);

        // Liquidating the debt position
        POOL.liquidationCall(collateralAsset, borrowedAsset, user, debtToCover, false);
        console.log("Liquidated");

        // Checking initial collateral balance versus collateral balance after liquidation
        uint256 collateralBalanceAfter = IERC20(collateralAsset).balanceOf(address(this));
        uint256 debtBalanceAfte = IERC20(borrowedAsset).balanceOf(address(this));
        console.log("Debt Balance After", debtBalanceAfte);
        console.log("Collateral Balance After", collateralBalanceAfter);
        vars.diffCollateralBalance = collateralBalanceAfter - vars.initCollateralBalance;
        console.log("diffCollateralBalance", vars.diffCollateralBalance);

        // calculate and swap the collateral tokens necessary
        // to repay the flashLoanSimple
        if (collateralAsset != borrowedAsset) {
            uint256 flashBorrowedAssetAfter = IERC20(borrowedAsset).balanceOf(address(this));
            console.log("Flash Borrowed Asset After", flashBorrowedAssetAfter);
            vars.diffFlashBorrowedBalance = flashBorrowedAssetAfter - vars.borrowedAssetLeftovers;
            console.log("diffFlashBorrowedBalance", vars.diffFlashBorrowedBalance);
            uint256 amountOut = vars.flashLoanDebt - vars.diffFlashBorrowedBalance;
            console.log("Debt tokens I want to receive", amountOut);
            console.log("Swapping collateral to debt");
            vars.soldAmount = swapExactOutputSingle(
                collateralAsset,
                borrowedAsset,
                amountOut,
                vars.diffCollateralBalance, //* (10**decimalDiff)
                poolFee1,
                poolFee2,
                pathToken,
                usePath
            );

            // Checking for tokens to transfer to contract owner
            console.log("Figuring out remaining collateral");
            vars.remainingTokens = vars.diffCollateralBalance - vars.soldAmount;
            console.log("The error is here");
        } else {
            vars.remainingTokens = vars.diffCollateralBalance - premium;
        }

        // Allow repay of flash loan
        IERC20(borrowedAsset).approve(address(POOL), vars.flashLoanDebt);
    }

    /**
     * @notice swapExactOutputSingle swaps a minimum possible amount of DAI for a fixed amount of WETH.
     * @dev The calling address must approve this contract to spend its DAI for this function to succeed. As the amount of input DAI is variable,
     * @dev the calling address will need to approve for a slightly higher amount, anticipating some variance.
     * @param amountOut The exact amount of WETH9 to receive from the swap.
     * @param amountInMaximum The amount of DAI we are willing to spend to receive the specified amount of WETH9.
     * @return amountIn The amount of DAI actually spent in the swap.
     */
    function swapExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint24 poolFee1,
        uint24 poolFee2,
        address pathToken,
        bool usePath
    ) internal returns (uint256 amountIn) {
        console.log("Approving swap router to spend collateral tokens");
        console.log("Amount to be approved", amountInMaximum);
        TransferHelper.safeApprove(tokenIn, address(swapRouter), amountInMaximum);
        require(
            IERC20(tokenIn).allowance(address(this), address(swapRouter)) == amountInMaximum,
            "Approval error"
        );

        if (usePath == false) {
            ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter
                .ExactOutputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: poolFee1,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountOut: amountOut,
                    amountInMaximum: amountInMaximum,
                    sqrtPriceLimitX96: 0
                });

            console.log("Getting debt tokens to repay flashLoan");
            console.log("COlateral balance", IERC20(tokenIn).balanceOf(address(this)));
            amountIn = swapRouter.exactOutputSingle(params);
        } else {
            ISwapRouter.ExactOutputParams memory params = ISwapRouter.ExactOutputParams({
                path: abi.encodePacked(tokenOut, poolFee2, pathToken, poolFee1, tokenIn),
                recipient: address(this),
                deadline: block.timestamp,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            });
            console.log("Getting debt tokens to repay flashLoan");
            console.log("COlateral balance", IERC20(tokenIn).balanceOf(address(this)));
            amountIn = swapRouter.exactOutput(params);
        }
        console.log("Taking approval from swapRouter");
        if (amountIn < amountInMaximum) {
            TransferHelper.safeApprove(tokenIn, address(swapRouter), 0);
        }
        console.log("Approval taken");
        console.log(amountIn);
        return amountIn;
    }

    /**
     * @notice Decodes the parameters obtained from myFlashLoan function
     * @param params The byte-encoded params passed when initiating the flashloan
     * @return LiquidationParams memory struct
     */
    function _decodeParams(bytes memory params) internal pure returns (LiquidationParams memory) {
        (
            address collateralAsset,
            address borrowedAsset,
            address user,
            uint256 debtToCover,
            uint24 poolFee1,
            uint24 poolFee2,
            address pathToken,
            bool usePath
        ) = abi.decode(params, (address, address, address, uint256, uint24, uint24, address, bool));

        return
            LiquidationParams(
                collateralAsset,
                borrowedAsset,
                user,
                debtToCover,
                poolFee1,
                poolFee2,
                pathToken,
                usePath
            );
    }

    /**
     * @notice myFlashLoan initiates a flashLoanSimple,vpasses in the parameters necessary to liquidate a position, and transfers the collateral received to the contract owner
     * @param tokenAddress The address of the token to be flash-borrowed.
     * @param _amount The amount of asset to be flash-borrowed.
     * @param colToken The address of the collateral asset received from liquidating.
     * @param user The address of the user whose position is being liquidated.
     * @param decimals The amount of decimals for the tokenAddress asset (debt token).
     * @param poolFee1 The fee associated with the Uniswap Pool.
     * @param poolFee2 The fee associated with the Uniswap Pool.
     * @param pathToken The token to swap between two other tokens from the Uniswap Pool.
     * @param usePath To decide between a single and multihop swap.
     */
    function myFlashLoan(
        address tokenAddress,
        uint256 _amount,
        address colToken,
        address user,
        uint256 decimals,
        uint24 poolFee1,
        uint24 poolFee2,
        address pathToken,
        bool usePath
    ) external onlyOwner {
        address receiverAddress = address(this);

        address asset = tokenAddress;
        uint256 amount = _amount / 10**(18 - decimals);

        uint16 referralCode = 0;

        bytes memory params = abi.encode(
            colToken,
            asset,
            user,
            amount,
            poolFee1,
            poolFee2,
            pathToken,
            usePath
        );
        console.log(amount);

        // Iniating flashLoanSimple
        POOL.flashLoanSimple(receiverAddress, asset, amount, params, referralCode);

        // Transferring remaining collateral tokens after liquidation and flashLoan have been repaid
        LiquidationParams memory decodedParams = _decodeParams(params);
        console.log("Flash loan repayed, transferring remaining collateral tokens");
        // Transfer the remaining debt and collateral to the msg.sender
        uint256 allBalance = IERC20(decodedParams.collateralAsset).balanceOf(address(this));
        uint256 debtTokensRemaining = IERC20(decodedParams.borrowedAsset).balanceOf(address(this));
        console.log("remaining debt", debtTokensRemaining);
        if (debtTokensRemaining > 0) {
            IERC20(decodedParams.borrowedAsset).transfer(msg.sender, debtTokensRemaining);
        }
        console.log(decodedParams.collateralAsset, allBalance);
        IERC20(decodedParams.collateralAsset).transfer(msg.sender, allBalance);
        uint256 userBalance = IERC20(decodedParams.collateralAsset).balanceOf(msg.sender);
        console.log("user bal", userBalance);
    }
}
