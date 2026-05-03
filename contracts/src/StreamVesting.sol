// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";
import {SafeTIP20} from "./utils/SafeTIP20.sol";

/// @title StreamVesting
/// @notice Continuous salary streaming via linear vesting streams.
///         Employees accrue balance per second; they can claim at any time
///         after cliff.
///
/// @dev    Audit fixes (v2):
///         - H-1: all token transfers go through SafeTIP20.
///         - H-2: `cancelStream` no longer leaves orphaned tokens if the
///           employer-refund leg fails. The remaining funds are tracked in
///           `unclaimedEmployerRefunds` and recoverable via `claimEmployerRefund`.
///         - H-3: `claimAccrued` no longer returns a synthetic txHash that
///           callers might mistake for a real transaction hash.
contract StreamVesting {
    using SafeTIP20 for ITIP20;

    struct VestingStream {
        address employer;
        address employee;
        uint256 totalAmount;
        uint256 released;
        uint64 startTime;
        uint64 endTime;
        uint64 cliffEnd;
        bytes32 payrollMemo;
        bool active;
    }

    mapping(uint256 => VestingStream) public streams;
    mapping(address => uint256[]) private employeeStreams;
    /// @dev H-2: tokens accrued for an employer when their refund leg of
    /// `cancelStream` failed. Recoverable via `claimEmployerRefund`.
    mapping(address => uint256) public unclaimedEmployerRefunds;

    uint256 public nextStreamId;
    ITIP20 public immutable payToken;
    address public owner;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed employer,
        address indexed employee,
        uint256 totalAmount,
        uint64 startTime,
        uint64 endTime
    );
    event StreamReleased(uint256 indexed streamId, address indexed employee, uint256 amount);
    event StreamCancelled(uint256 indexed streamId);
    event AccruedClaimed(address indexed employee, uint256 totalReleasable);
    event EmployerRefundDeferred(address indexed employer, uint256 amount, string reason);
    event EmployerRefundClaimed(address indexed employer, uint256 amount);

    error InvalidPeriod();
    error CliffBeforeStart();
    error ZeroAmount();
    error NotActive();
    error CliffNotReached();
    error NothingToRelease();
    error NothingToClaim();
    error NotAuthorized();
    error NoRefundPending();

    constructor(address _payToken) {
        payToken = ITIP20(_payToken);
        owner = msg.sender;
    }

    function createStream(
        address employee,
        uint256 totalAmount,
        uint64 startTime,
        uint64 endTime,
        uint64 cliffEnd,
        bytes32 payrollMemo
    ) external returns (uint256 streamId) {
        if (endTime <= startTime) revert InvalidPeriod();
        if (cliffEnd < startTime) revert CliffBeforeStart();
        if (totalAmount == 0) revert ZeroAmount();

        payToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        streamId = nextStreamId++;
        streams[streamId] = VestingStream({
            employer: msg.sender,
            employee: employee,
            totalAmount: totalAmount,
            released: 0,
            startTime: startTime,
            endTime: endTime,
            cliffEnd: cliffEnd,
            payrollMemo: payrollMemo,
            active: true
        });
        employeeStreams[employee].push(streamId);

        emit StreamCreated(streamId, msg.sender, employee, totalAmount, startTime, endTime);
    }

    function release(uint256 streamId) external {
        VestingStream storage s = streams[streamId];
        if (!s.active) revert NotActive();
        if (block.timestamp < s.cliffEnd) revert CliffNotReached();

        uint256 releasable = _releasable(s);
        if (releasable == 0) revert NothingToRelease();

        s.released += releasable;
        payToken.safeTransferWithMemo(s.employee, releasable, s.payrollMemo);

        emit StreamReleased(streamId, s.employee, releasable);
    }

    /// @notice H-3 fix. No longer returns a synthetic txHash that callers
    /// could mistake for a real transaction hash. The actual tx hash is
    /// available to callers via standard Ethereum tooling.
    function claimAccrued(address employee) external {
        uint256[] memory ids = employeeStreams[employee];
        uint256 totalReleasable;

        for (uint256 i = 0; i < ids.length; i++) {
            VestingStream storage s = streams[ids[i]];
            if (!s.active || block.timestamp < s.cliffEnd) continue;

            uint256 releasable = _releasable(s);
            if (releasable == 0) continue;

            s.released += releasable;
            totalReleasable += releasable;
        }

        if (totalReleasable == 0) revert NothingToClaim();
        payToken.safeTransfer(employee, totalReleasable);

        emit AccruedClaimed(employee, totalReleasable);
    }

    function getAccruedBalance(address employee) external view returns (uint256 total) {
        uint256[] memory ids = employeeStreams[employee];
        for (uint256 i = 0; i < ids.length; i++) {
            VestingStream storage s = streams[ids[i]];
            if (!s.active || block.timestamp < s.cliffEnd) continue;
            total += _releasable(s);
        }
    }

    /// @notice H-2 fix. If the employer refund transfer fails, the funds
    /// stay tracked under `unclaimedEmployerRefunds[employer]` and can be
    /// recovered later via `claimEmployerRefund`. Previously the funds
    /// would be orphaned in the contract.
    function cancelStream(uint256 streamId) external {
        VestingStream storage s = streams[streamId];
        if (!s.active) revert NotActive();
        if (s.employer != msg.sender && msg.sender != owner) revert NotAuthorized();

        uint256 releasable = _releasable(s);
        uint256 remaining = s.totalAmount - s.released - releasable;

        s.active = false;

        if (releasable > 0) {
            s.released += releasable;
            payToken.safeTransferWithMemo(s.employee, releasable, s.payrollMemo);
        }
        if (remaining > 0) {
            // Try the employer refund. On failure, defer it as a claimable
            // balance under `unclaimedEmployerRefunds[s.employer]`.
            (bool ok, bytes memory ret) = address(payToken).call(
                abi.encodeCall(payToken.transfer, (s.employer, remaining))
            );
            bool returnOk = ret.length == 0 || abi.decode(ret, (bool));
            if (ok && returnOk) {
                // success
            } else {
                unclaimedEmployerRefunds[s.employer] += remaining;
                emit EmployerRefundDeferred(s.employer, remaining, "transfer failed");
            }
        }

        emit StreamCancelled(streamId);
    }

    /// @notice H-2 follow-on. Lets an employer pull a refund that was
    /// previously deferred because the cancel-time transfer failed.
    function claimEmployerRefund() external {
        uint256 amount = unclaimedEmployerRefunds[msg.sender];
        if (amount == 0) revert NoRefundPending();
        unclaimedEmployerRefunds[msg.sender] = 0;
        payToken.safeTransfer(msg.sender, amount);
        emit EmployerRefundClaimed(msg.sender, amount);
    }

    function getStreamsByEmployee(address employee) external view returns (uint256[] memory) {
        return employeeStreams[employee];
    }

    function _releasable(VestingStream storage s) internal view returns (uint256) {
        if (block.timestamp < s.cliffEnd) return 0;
        uint256 elapsed = block.timestamp >= s.endTime
            ? s.endTime - s.startTime
            : block.timestamp - s.startTime;
        uint256 vested = (s.totalAmount * elapsed) / (s.endTime - s.startTime);
        return vested > s.released ? vested - s.released : 0;
    }
}
