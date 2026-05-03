// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "../interfaces/ITIP20.sol";

/// @title SafeTIP20
/// @notice Defensive wrappers for TIP-20 transfer calls. Reverts on a `false`
///         return value (legacy/non-compliant tokens that signal failure
///         without reverting) and on tokens that return no data at all.
library SafeTIP20 {
    error TIP20TransferFailed();
    error TIP20TransferFromFailed();
    error TIP20TransferWithMemoFailed();
    error TIP20TransferFromWithMemoFailed();

    function safeTransfer(ITIP20 token, address to, uint256 amount) internal {
        bytes memory data = abi.encodeCall(token.transfer, (to, amount));
        _callOptionalReturn(address(token), data, TIP20TransferFailed.selector);
    }

    function safeTransferFrom(ITIP20 token, address from, address to, uint256 amount) internal {
        bytes memory data = abi.encodeCall(token.transferFrom, (from, to, amount));
        _callOptionalReturn(address(token), data, TIP20TransferFromFailed.selector);
    }

    function safeTransferWithMemo(ITIP20 token, address to, uint256 amount, bytes32 memo) internal {
        bytes memory data = abi.encodeCall(token.transferWithMemo, (to, amount, memo));
        _callOptionalReturn(address(token), data, TIP20TransferWithMemoFailed.selector);
    }

    function safeTransferFromWithMemo(
        ITIP20 token,
        address from,
        address to,
        uint256 amount,
        bytes32 memo
    ) internal {
        bytes memory data = abi.encodeCall(token.transferFromWithMemo, (from, to, amount, memo));
        _callOptionalReturn(address(token), data, TIP20TransferFromWithMemoFailed.selector);
    }

    function _callOptionalReturn(address target, bytes memory data, bytes4 errorSelector) private {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            // Bubble up the original revert if the target reverted with a reason.
            if (ret.length > 0) {
                assembly {
                    let r := mload(ret)
                    revert(add(ret, 0x20), r)
                }
            }
            assembly {
                mstore(0x00, errorSelector)
                revert(0x00, 0x04)
            }
        }
        if (ret.length > 0 && !abi.decode(ret, (bool))) {
            assembly {
                mstore(0x00, errorSelector)
                revert(0x00, 0x04)
            }
        }
    }
}
