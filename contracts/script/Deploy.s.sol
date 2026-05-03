// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PayrollTreasury.sol";
import "../src/PayrollBatcher.sol";
import "../src/EmployeeRegistry.sol";
import "../src/StreamVesting.sol";
import "../src/YieldRouter.sol";

/// @title Deploy
/// @notice Deploys the v2 Remlo contracts (post-audit) and wires them.
///
/// Order:
///   1. PayrollTreasury
///   2. EmployeeRegistry (uses Tempo TIP-403 default precompile)
///   3. PayrollBatcher (depends on treasury) → wire batcher into treasury,
///      then wire registry into batcher (enables H-4 recipient validation)
///   4. StreamVesting
///   5. YieldRouter
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $TEMPO_RPC --broadcast \
///     --tempo.fee-token 0x20c0000000000000000000000000000000000000 \
///     --gas-limit 20000000
contract Deploy is Script {
    // pathUSD TIP-20 (same address on testnet + mainnet — TIP-20 precompile)
    address constant PATHUSD = 0x20C0000000000000000000000000000000000000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. PayrollTreasury
        PayrollTreasury treasury = new PayrollTreasury(PATHUSD);
        console2.log("PayrollTreasury:", address(treasury));

        // 2. EmployeeRegistry (zero arg = default TIP-403 precompile)
        EmployeeRegistry registry = new EmployeeRegistry(address(0));
        console2.log("EmployeeRegistry:", address(registry));

        // 3. PayrollBatcher (depends on treasury) + wiring
        PayrollBatcher batcher = new PayrollBatcher(PATHUSD, address(treasury));
        console2.log("PayrollBatcher:", address(batcher));
        treasury.setBatcher(address(batcher));
        batcher.setEmployeeRegistry(address(registry));

        // 4. StreamVesting
        StreamVesting vesting = new StreamVesting(PATHUSD);
        console2.log("StreamVesting:", address(vesting));

        // 5. YieldRouter
        YieldRouter yieldRouter = new YieldRouter(PATHUSD);
        console2.log("YieldRouter:", address(yieldRouter));

        vm.stopBroadcast();

        console2.log("\n=== v2 Deployment Complete ===");
        console2.log("NEXT_PUBLIC_PAYROLL_TREASURY=", address(treasury));
        console2.log("NEXT_PUBLIC_PAYROLL_BATCHER=", address(batcher));
        console2.log("NEXT_PUBLIC_EMPLOYEE_REGISTRY=", address(registry));
        console2.log("NEXT_PUBLIC_STREAM_VESTING=", address(vesting));
        console2.log("NEXT_PUBLIC_YIELD_ROUTER=", address(yieldRouter));
    }
}
