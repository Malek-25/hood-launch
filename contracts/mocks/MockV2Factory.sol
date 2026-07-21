// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    event PairCreated(address indexed token0, address indexed token1, address pair);

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "BAD_PAIR");
        require(getPair[tokenA][tokenB] == address(0), "PAIR_EXISTS");
        pair = address(uint160(uint256(keccak256(abi.encode(tokenA, tokenB, block.number)))));
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
        emit PairCreated(tokenA, tokenB, pair);
    }
}
