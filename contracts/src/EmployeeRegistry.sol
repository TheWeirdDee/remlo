// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP403} from "./interfaces/ITIP403.sol";

/// @title EmployeeRegistry
/// @notice On-chain registry mapping employee IDs to wallet addresses.
///         Enforces TIP-403 compliance checks on registration.
///
/// @dev    Audit fixes (v2):
///         - C-6: `getWallet` uses a real reverse mapping (was previously
///           reading from a placeholder `employerWallets[bytes32(0)]` and
///           always returning address(0)).
///         - M-2: `tip403Registry` is now `immutable` set in the constructor
///           rather than a mutable storage slot with no setter.
contract EmployeeRegistry {
    struct Employee {
        address wallet;
        bytes32 employerId;
        uint64 policyId;
        bytes32 employeeIdHash;
        bool active;
    }

    struct EmployerConfig {
        uint64 policyId;
        address admin;
        bool active;
    }

    mapping(address => Employee) public employees;
    mapping(bytes32 => EmployerConfig) public employerConfigs;
    mapping(bytes32 => address[]) private employerWallets;

    /// @dev C-6 fix: reverse mapping from `keccak256(employerId, employeeIdHash)`
    /// to wallet so `getWallet` resolves in O(1) instead of returning a fixed zero.
    mapping(bytes32 => address) private walletByEmployeeKey;

    /// @dev M-2: Tempo TIP-403 registry precompile. Immutable per-deploy
    /// (Tempo addresses these precompiles consistently across the chain).
    address public immutable tip403Registry;
    address public owner;

    event EmployeeRegistered(address indexed wallet, bytes32 indexed employerId, bytes32 employeeIdHash);
    event EmployeeDeactivated(address indexed wallet);
    event EmployerConfigured(bytes32 indexed employerId, address admin, uint64 policyId);

    error NotOwner();
    error NotEmployerAdmin();
    error EmployerNotConfigured();
    error WalletAlreadyRegistered();
    error WalletNotActive();
    error NotAuthorized();
    error ComplianceCheckFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyEmployerAdmin(bytes32 employerId) {
        if (employerConfigs[employerId].admin != msg.sender) revert NotEmployerAdmin();
        _;
    }

    constructor(address _tip403Registry) {
        // Default to Tempo's canonical TIP-403 precompile when zero is passed.
        tip403Registry = _tip403Registry == address(0)
            ? 0x403c000000000000000000000000000000000000
            : _tip403Registry;
        owner = msg.sender;
    }

    function configureEmployer(bytes32 employerId, address admin, uint64 policyId) external onlyOwner {
        employerConfigs[employerId] = EmployerConfig(policyId, admin, true);
        emit EmployerConfigured(employerId, admin, policyId);
    }

    function registerEmployee(
        address wallet,
        bytes32 employerId,
        bytes32 employeeIdHash
    ) external onlyEmployerAdmin(employerId) {
        EmployerConfig memory cfg = employerConfigs[employerId];
        if (!cfg.active) revert EmployerNotConfigured();

        if (cfg.policyId > 0) {
            bool authorized = ITIP403(tip403Registry).isAuthorized(cfg.policyId, wallet);
            if (!authorized) revert ComplianceCheckFailed();
        }

        if (employees[wallet].active) revert WalletAlreadyRegistered();

        employees[wallet] = Employee(wallet, employerId, cfg.policyId, employeeIdHash, true);
        employerWallets[employerId].push(wallet);
        walletByEmployeeKey[_employeeKey(employerId, employeeIdHash)] = wallet;

        emit EmployeeRegistered(wallet, employerId, employeeIdHash);
    }

    function deactivateEmployee(address wallet) external {
        Employee storage emp = employees[wallet];
        if (!emp.active) revert WalletNotActive();
        if (employerConfigs[emp.employerId].admin != msg.sender && msg.sender != owner) revert NotAuthorized();
        emp.active = false;
        // Clear reverse mapping so a subsequent registration of the same
        // (employerId, employeeIdHash) pair to a new wallet resolves cleanly.
        delete walletByEmployeeKey[_employeeKey(emp.employerId, emp.employeeIdHash)];
        emit EmployeeDeactivated(wallet);
    }

    /// @notice C-6 fix. Returns wallet for (employerId, employeeIdHash) in O(1).
    /// Returns address(0) if no such employee is registered for that employer.
    function getWallet(bytes32 employerId, bytes32 employeeIdHash) external view returns (address) {
        return walletByEmployeeKey[_employeeKey(employerId, employeeIdHash)];
    }

    function getEmployeeCount(bytes32 employerId) external view returns (uint256) {
        return employerWallets[employerId].length;
    }

    function getEmployerWallets(bytes32 employerId) external view returns (address[] memory) {
        return employerWallets[employerId];
    }

    function isRegistered(address wallet) external view returns (bool) {
        return employees[wallet].active;
    }

    /// @notice True iff `wallet` is an active employee of `employerId`.
    /// Used by PayrollBatcher (H-4) to validate batch recipients on-chain.
    function isEmployedBy(address wallet, bytes32 employerId) external view returns (bool) {
        Employee memory emp = employees[wallet];
        return emp.active && emp.employerId == employerId;
    }

    function _employeeKey(bytes32 employerId, bytes32 employeeIdHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(employerId, employeeIdHash));
    }
}
