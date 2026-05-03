// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";
import {PayrollTreasury} from "./PayrollTreasury.sol";
import {EmployeeRegistry} from "./EmployeeRegistry.sol";
import {ReentrancyGuard} from "./utils/ReentrancyGuard.sol";

/// @title PayrollBatcher
/// @notice Executes batch payroll disbursements using TIP-20 transferWithMemo.
///         The employer (or an authorized agent) calls executeBatchPayroll;
///         this contract pulls locked funds from PayrollTreasury and
///         distributes them atomically.
///
/// @dev    Audit fixes (v2):
///         - M-3: `MAX_BATCH_SIZE` caps the number of recipients per call
///           so an oversized batch can't brick the run via gas exhaustion.
///         - M-6: `PaymentSent` event includes `employerId` directly so
///           indexers don't have to decode the memo to attribute payments.
///         - H-4: optional EmployeeRegistry validation. When the registry is
///           configured, every recipient must be an active employee of the
///           supplied `employerId`. This is defense-in-depth against a
///           compromised authorized agent.
contract PayrollBatcher is ReentrancyGuard {
    ITIP20 public immutable payToken;
    PayrollTreasury public immutable treasury;

    /// @dev H-4: optional. If set to a non-zero address, every recipient is
    /// validated against the registry. Owner can set/unset.
    EmployeeRegistry public employeeRegistry;

    address public owner;
    mapping(address => bool) public authorizedAgents;

    uint256 public constant MAX_BATCH_SIZE = 500;

    event PayrollBatchExecuted(address indexed agent, bytes32 indexed employerId, uint256 recipientCount, uint256 timestamp);
    event PaymentSent(bytes32 indexed employerId, address indexed recipient, uint256 amount, bytes32 memo);
    event AgentAuthorized(address indexed agent);
    event AgentRevoked(address indexed agent);
    event EmployeeRegistrySet(address indexed registry);

    error NotOwner();
    error NotAuthorizedAgent();
    error LengthMismatch();
    error EmptyBatch();
    error BatchTooLarge();
    error RecipientNotEmployed(address recipient);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedAgent() {
        if (!authorizedAgents[msg.sender] && msg.sender != owner) revert NotAuthorizedAgent();
        _;
    }

    constructor(address _payToken, address _treasury) {
        payToken = ITIP20(_payToken);
        treasury = PayrollTreasury(_treasury);
        owner = msg.sender;
        authorizedAgents[msg.sender] = true;
    }

    function setEmployeeRegistry(address _registry) external onlyOwner {
        employeeRegistry = EmployeeRegistry(_registry);
        emit EmployeeRegistrySet(_registry);
    }

    function authorizeAgent(address agent) external onlyOwner {
        authorizedAgents[agent] = true;
        emit AgentAuthorized(agent);
    }

    function revokeAgent(address agent) external onlyOwner {
        authorizedAgents[agent] = false;
        emit AgentRevoked(agent);
    }

    /// @notice Execute a batch payroll disbursement.
    /// @param recipients   Array of employee wallet addresses.
    /// @param amounts      Corresponding payment amounts (in TIP-20 token base units).
    /// @param memos        32-byte ISO 20022 memos per payment.
    /// @param employerId   Keccak256 identifier of the employer in PayrollTreasury.
    function executeBatchPayroll(
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata memos,
        bytes32 employerId
    ) external onlyAuthorizedAgent nonReentrant {
        if (recipients.length != amounts.length || amounts.length != memos.length) revert LengthMismatch();
        if (recipients.length == 0) revert EmptyBatch();
        if (recipients.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        // H-4 (optional): validate every recipient is an active employee
        // of `employerId` when the EmployeeRegistry is configured.
        EmployeeRegistry registry = employeeRegistry;
        bool validate = address(registry) != address(0);

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (validate && !registry.isEmployedBy(recipients[i], employerId)) {
                revert RecipientNotEmployed(recipients[i]);
            }
            total += amounts[i];
        }

        treasury.lockFunds(employerId, total);

        for (uint256 i = 0; i < recipients.length; i++) {
            treasury.releaseTo(employerId, recipients[i], amounts[i]);
            emit PaymentSent(employerId, recipients[i], amounts[i], memos[i]);
        }

        emit PayrollBatchExecuted(msg.sender, employerId, recipients.length, block.timestamp);
    }
}
