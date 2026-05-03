// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";
import {SafeTIP20} from "./utils/SafeTIP20.sol";

/// @title YieldRouter
/// @notice Routes idle employer treasury funds to yield strategies and
///         manages per-employer yield model configuration.
///
/// @dev    Audit fixes (v2):
///         - C-2: `setYieldConfig` is now gated to the employer admin (set by
///           the contract owner per employer). Anonymous flips are blocked.
///         - C-3: `distributeYield` reverts pending real strategy wiring
///           (was previously moving accounting state without transferring
///           any tokens — fictional yield).
///         - C-4: `sweepUnaccounted` recovers tokens that landed via direct
///           transfer without touching accounted employer deposits. Same
///           shape as PayrollTreasury C-1 fix.
///         - C-5: `rebalance` is now gated to employer admin, same as setYieldConfig.
///         - H-5: `yieldStrategy` must be on the owner-maintained allow-list.
contract YieldRouter {
    using SafeTIP20 for ITIP20;

    enum YieldModel { EMPLOYER_KEEPS, EMPLOYEE_BONUS, SPLIT }

    struct YieldConfig {
        YieldModel model;
        uint16 employeeSplitBps;
        address yieldStrategy;
    }

    struct YieldPosition {
        uint256 deposited;
        uint256 yieldEarned;
        uint64 lastUpdated;
    }

    mapping(bytes32 => YieldConfig) public yieldConfig;
    mapping(bytes32 => YieldPosition) public positions;
    mapping(bytes32 => address) public employerAdmins;
    mapping(address => bool) public approvedStrategies;
    address[] public yieldSources;

    /// @dev Running aggregate of all employer deposits. Used by
    /// `sweepUnaccounted` to ensure the owner can never touch user funds.
    uint256 public totalAccountedDeposits;

    ITIP20 public immutable payToken;
    address public owner;

    uint256 public constant APY_BPS = 370;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    event YieldDeposited(bytes32 indexed employerId, uint256 amount);
    event YieldDistributed(bytes32 indexed employerId, uint256 employerShare, uint256 employeeShare);
    event YieldConfigUpdated(bytes32 indexed employerId, YieldModel model, uint16 employeeSplitBps);
    event Rebalanced(bytes32 indexed employerId, uint256[] targetAllocation);
    event EmployerAdminSet(bytes32 indexed employerId, address indexed admin);
    event StrategyApprovalChanged(address indexed strategy, bool approved);
    event UnaccountedSwept(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotEmployerAdmin();
    error UnapprovedStrategy();
    error InvalidBps();
    error ZeroAmount();
    error ZeroAddress();
    error LengthMismatch();
    error AllocationMustSumToFull();
    error NotImplemented();
    error WouldTouchAccountedFunds();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyEmployerAdmin(bytes32 employerId) {
        if (employerAdmins[employerId] != msg.sender && msg.sender != owner) revert NotEmployerAdmin();
        _;
    }

    constructor(address _payToken) {
        if (_payToken == address(0)) revert ZeroAddress();
        payToken = ITIP20(_payToken);
        owner = msg.sender;
    }

    function setEmployerAdmin(bytes32 employerId, address admin) external onlyOwner {
        if (admin == address(0)) revert ZeroAddress();
        employerAdmins[employerId] = admin;
        emit EmployerAdminSet(employerId, admin);
    }

    function setStrategyApproval(address strategy, bool approved) external onlyOwner {
        if (strategy == address(0)) revert ZeroAddress();
        approvedStrategies[strategy] = approved;
        emit StrategyApprovalChanged(strategy, approved);
    }

    function addYieldSource(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        yieldSources.push(source);
    }

    /// @notice C-2 + H-5 fix. Set per-employer yield config. Caller must be
    /// the configured employer admin (or contract owner). The strategy must
    /// be on the owner-maintained allow-list, OR address(0) for "no strategy."
    function setYieldConfig(
        bytes32 employerId,
        YieldModel model,
        uint16 employeeSplitBps,
        address strategy
    ) external onlyEmployerAdmin(employerId) {
        if (employeeSplitBps > BPS_DENOMINATOR) revert InvalidBps();
        if (strategy != address(0) && !approvedStrategies[strategy]) revert UnapprovedStrategy();
        yieldConfig[employerId] = YieldConfig(model, employeeSplitBps, strategy);
        emit YieldConfigUpdated(employerId, model, employeeSplitBps);
    }

    function depositToYield(bytes32 employerId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        payToken.safeTransferFrom(msg.sender, address(this), amount);

        YieldPosition storage pos = positions[employerId];
        pos.yieldEarned += _accrued(pos);
        pos.deposited += amount;
        pos.lastUpdated = uint64(block.timestamp);

        totalAccountedDeposits += amount;
        emit YieldDeposited(employerId, amount);
    }

    /// @notice C-3 fix. Distribution requires real strategy wiring; not
    /// shipping with the accounting-only stub that misled callers into
    /// believing yield had moved.
    function distributeYield(bytes32 /*employerId*/) external pure {
        revert NotImplemented();
    }

    /// @notice C-5 fix. Rebalance requires admin or owner.
    function rebalance(bytes32 employerId, uint256[] calldata targetAllocation)
        external
        onlyEmployerAdmin(employerId)
    {
        if (targetAllocation.length != yieldSources.length) revert LengthMismatch();
        uint256 total;
        for (uint256 i = 0; i < targetAllocation.length; i++) {
            total += targetAllocation[i];
        }
        if (total != BPS_DENOMINATOR) revert AllocationMustSumToFull();
        emit Rebalanced(employerId, targetAllocation);
    }

    /// @notice C-4 fix. Sweep unaccounted funds (mirrors PayrollTreasury C-1).
    function sweepUnaccounted(ITIP20 token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 raw = token.balanceOf(address(this));
        uint256 sweepable;
        if (address(token) == address(payToken)) {
            sweepable = raw > totalAccountedDeposits ? raw - totalAccountedDeposits : 0;
        } else {
            sweepable = raw;
        }
        if (amount > sweepable) revert WouldTouchAccountedFunds();
        token.safeTransfer(to, amount);
        emit UnaccountedSwept(address(token), to, amount);
    }

    function getCurrentAPY() external pure returns (uint256) {
        return APY_BPS;
    }

    function getYieldSources() external view returns (address[] memory) {
        return yieldSources;
    }

    function getAllocation() external view returns (uint256[] memory allocations) {
        allocations = new uint256[](yieldSources.length);
        if (yieldSources.length > 0) {
            uint256 each = BPS_DENOMINATOR / yieldSources.length;
            for (uint256 i = 0; i < yieldSources.length; i++) {
                allocations[i] = each;
            }
        }
    }

    function getAccruedYield(bytes32 employerId) external view returns (uint256) {
        YieldPosition storage pos = positions[employerId];
        return _accrued(pos) + pos.yieldEarned;
    }

    function _accrued(YieldPosition storage pos) internal view returns (uint256) {
        if (pos.deposited == 0 || pos.lastUpdated == 0) return 0;
        uint256 elapsed = block.timestamp - pos.lastUpdated;
        return (pos.deposited * APY_BPS * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }
}
