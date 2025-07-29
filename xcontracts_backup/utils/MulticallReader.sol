// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MulticallReader
 * @notice Utility contract that bundles multiple read-only calls in a single transaction.
 * This reduces RPC requests by aggregating queries on-chain.
 */
contract MulticallReader {
    struct Call {
        address target;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    /**
     * @notice Execute multiple static calls in a single request.
     * @param calls Array of call structures specifying target and calldata.
     * @return blockNumber Current block number.
     * @return returnData Array of each call's returned bytes.
     */
    function aggregate(Call[] calldata calls)
        external
        view
        returns (uint256 blockNumber, bytes[] memory returnData)
    {
        blockNumber = block.number;
        returnData = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.staticcall(calls[i].callData);
            require(success, "Multicall: call failed");
            returnData[i] = ret;
        }
    }

    /**
     * @notice Try executing multiple static calls, optionally allowing failures.
     * @param requireSuccess If true, reverts on the first failed call.
     * @param calls Array of call structures specifying target and calldata.
     * @return results Array with success flag and returned bytes for each call.
     */
    function tryAggregate(bool requireSuccess, Call[] calldata calls)
        external
        view
        returns (Result[] memory results)
    {
        results = new Result[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.staticcall(calls[i].callData);
            if (requireSuccess) {
                require(success, "Multicall: call failed");
            }
            results[i] = Result(success, ret);
        }
    }

    /** @notice Convenience helper returning the current block number. */
    function getBlockNumber() external view returns (uint256) {
        return block.number;
    }

    /** @notice Convenience helper returning the current block timestamp. */
    function getCurrentBlockTimestamp() external view returns (uint256) {
        return block.timestamp;
    }
}
