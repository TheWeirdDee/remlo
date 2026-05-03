// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Rescuer
/// @notice One-shot recovery contract for funds sent to a CREATE address that
///         had no code at receive time. Deployed at the predicted CREATE
///         address (deployer + nonce 0) on Tempo mainnet to recover MPP fees
///         that landed on `0xeFac4A0cC3D54903746e811f6cd45DD7F43A43a5` while
///         that address had no contract code on mainnet.
contract Rescuer {
    address public immutable owner;

    event Rescued(address indexed token, address indexed to, uint256 amount);
    event NativeRescued(address indexed to, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    /// @notice Sweep the contract's full balance of `token` to `to`.
    function rescue(IERC20 token, address to) external {
        require(msg.sender == owner, "not owner");
        require(to != address(0), "zero to");
        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "zero balance");
        require(token.transfer(to, bal), "transfer failed");
        emit Rescued(address(token), to, bal);
    }

    /// @notice Sweep the contract's full native (pathUSD) balance to `to`.
    function rescueNative(address payable to) external {
        require(msg.sender == owner, "not owner");
        require(to != address(0), "zero to");
        uint256 bal = address(this).balance;
        require(bal > 0, "zero balance");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "native transfer failed");
        emit NativeRescued(to, bal);
    }

    receive() external payable {}
}
