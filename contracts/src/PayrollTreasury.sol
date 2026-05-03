// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";
import {SafeTIP20} from "./utils/SafeTIP20.sol";

/// @title PayrollTreasury
/// @notice Holds employer payroll funds. Accepts TIP-20 deposits, tracks per-employer
///         available and locked balances, and releases funds to PayrollBatcher on demand.
///
/// @dev    Audit fixes (v2):
///         - C-1: `sweepUnaccounted` recovers tokens that landed via direct
///           transfer without touching accounted employer balances.
///         - M-1: `deposit` enforces memo[0:8] matches the derived employerId
///           prefix so off-chain accounting can't be confused.
///         - M-5: `unlockFunds` now emits an `Unlocked` event.
///         - H-1: all token transfers go through SafeTIP20.
contract PayrollTreasury {
    using SafeTIP20 for ITIP20;

    struct EmployerAccount {
        uint256 balance;
        uint256 lockedBalance;
        uint256 gasBudget;
        uint64 policyId;
        address admin;
        bool active;
    }

    mapping(bytes32 => EmployerAccount) public employers;

    /// @dev Running aggregate of accounted positions across all employers.
    /// Used by `sweepUnaccounted` to ensure the owner can never touch
    /// accounted employer funds.
    uint256 public totalAccountedPayToken;

    ITIP20 public immutable payToken;

    address public owner;
    address public batcher;

    event Deposited(bytes32 indexed employerId, address indexed sender, uint256 amount);
    event GasFunded(bytes32 indexed employerId, address indexed sender, uint256 amount);
    event BatcherSet(address indexed batcher);
    event Locked(bytes32 indexed employerId, uint256 amount);
    event Unlocked(bytes32 indexed employerId, uint256 amount);
    event Released(bytes32 indexed employerId, address indexed recipient, uint256 amount);
    event UnaccountedSwept(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotBatcher();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientLocked();
    error MemoEmployerMismatch();
    error WouldTouchAccountedFunds();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyBatcher() {
        if (msg.sender != batcher) revert NotBatcher();
        _;
    }

    constructor(address _payToken) {
        if (_payToken == address(0)) revert ZeroAddress();
        payToken = ITIP20(_payToken);
        owner = msg.sender;
    }

    function setBatcher(address _batcher) external onlyOwner {
        if (_batcher == address(0)) revert ZeroAddress();
        batcher = _batcher;
        emit BatcherSet(_batcher);
    }

    function deposit(uint256 amount, bytes32 memo) external {
        if (amount == 0) revert ZeroAmount();
        bytes32 employerId = keccak256(abi.encodePacked(msg.sender));

        // M-1: enforce memo[0:8] equals first 8 bytes of derived employerId.
        // Off-chain memo encoding documents the same convention; on-chain
        // enforcement catches drift.
        if (bytes8(memo) != bytes8(employerId)) revert MemoEmployerMismatch();

        payToken.safeTransferFromWithMemo(msg.sender, address(this), amount, memo);

        employers[employerId].balance += amount;
        totalAccountedPayToken += amount;
        if (!employers[employerId].active) {
            employers[employerId].admin = msg.sender;
            employers[employerId].active = true;
        }
        emit Deposited(employerId, msg.sender, amount);
    }

    function fundGasBudget(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        payToken.safeTransferFrom(msg.sender, address(this), amount);
        bytes32 employerId = keccak256(abi.encodePacked(msg.sender));
        employers[employerId].gasBudget += amount;
        totalAccountedPayToken += amount;
        emit GasFunded(employerId, msg.sender, amount);
    }

    /// @notice Lock funds for a pending payroll run. Called by PayrollBatcher.
    function lockFunds(bytes32 employerId, uint256 amount) external onlyBatcher {
        if (employers[employerId].balance < amount) revert InsufficientBalance();
        employers[employerId].balance -= amount;
        employers[employerId].lockedBalance += amount;
        emit Locked(employerId, amount);
    }

    /// @notice Release locked funds to a recipient. Called by PayrollBatcher.
    function releaseTo(bytes32 employerId, address recipient, uint256 amount) external onlyBatcher {
        if (employers[employerId].lockedBalance < amount) revert InsufficientLocked();
        employers[employerId].lockedBalance -= amount;
        totalAccountedPayToken -= amount;
        payToken.safeTransfer(recipient, amount);
        emit Released(employerId, recipient, amount);
    }

    /// @notice Unlock funds back to available (e.g. failed payroll run).
    function unlockFunds(bytes32 employerId, uint256 amount) external onlyBatcher {
        if (employers[employerId].lockedBalance < amount) revert InsufficientLocked();
        employers[employerId].lockedBalance -= amount;
        employers[employerId].balance += amount;
        emit Unlocked(employerId, amount);
    }

    /// @notice C-1 fix. Owner-only sweep of funds that landed on the contract
    /// via direct transfer (e.g. misrouted MPP fees, accidental sends, dust)
    /// WITHOUT touching any accounted employer position.
    ///
    /// For `payToken`: protected by the running `totalAccountedPayToken`
    /// aggregate. The owner can only sweep `balanceOf(this) - totalAccountedPayToken`.
    /// For any other token: the contract has no accounting on those, so the
    /// owner can sweep the full balance.
    function sweepUnaccounted(ITIP20 token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 raw = token.balanceOf(address(this));
        uint256 sweepable;
        if (address(token) == address(payToken)) {
            // Aggregate guard: only the delta between raw balance and tracked
            // positions is sweepable. Underflow guard protects against future
            // bugs that might double-count.
            sweepable = raw > totalAccountedPayToken ? raw - totalAccountedPayToken : 0;
        } else {
            sweepable = raw;
        }
        if (amount > sweepable) revert WouldTouchAccountedFunds();
        token.safeTransfer(to, amount);
        emit UnaccountedSwept(address(token), to, amount);
    }

    function getAvailableBalance(bytes32 employerId) external view returns (uint256) {
        return employers[employerId].balance;
    }

    function getLockedBalance(bytes32 employerId) external view returns (uint256) {
        return employers[employerId].lockedBalance;
    }

    function getEmployerAccount(bytes32 employerId) external view returns (EmployerAccount memory) {
        return employers[employerId];
    }

    /// @notice Convenience read: how much of the contract's payToken balance
    /// is unaccounted (sweepable). Returns 0 if the contract is exactly tracked.
    function getSweepableBalance(ITIP20 token) external view returns (uint256) {
        uint256 raw = token.balanceOf(address(this));
        if (address(token) == address(payToken)) {
            return raw > totalAccountedPayToken ? raw - totalAccountedPayToken : 0;
        }
        return raw;
    }
}
