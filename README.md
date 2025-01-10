# Aztec Technical Challenge

The test provides you an opportunity to demonstrate the following:

- Your ability to write a data structure algorithm (in this case a merkle tree).
- Your ability to write clean, idiomatic TypeScript.

## Rationale

A core data structure in the Aztec system is the merkle tree. It's a simple binary tree structure where the root node is represented by the hash of its two child hashes. Given any set of data in the leaves, this leads to a unique root. Furthermore, proof of existence of a piece of data can be represented by a hash path, a list of pairwise child hashes at each layer, from leaf to root. Aztec stores all of its notes in such data structures, and when proofs are generated they use hash paths to prove the data they are modifying exists.

In this test you will be working on an implementation of a merkle tree.

## Merkle Tree Structure

- The merkle tree is of depth `32`, and is fully formed with leaves consisting of `64` zero bytes at every index.
- When inserting an element of arbitrary length, the value must first be `hash`ed to `32` bytes using sha256.
- Each node of the tree is computed by `compress`ing its left and right subtree hashes and taking the resulting sha256 hash.
- For reference, an unpopulated merkle tree will have a root hash of `1c9a7e5ff1cf48b4ad1582d3f4e4a1004f3b20d8c5a2b71387a4254ad933ebc5`.

The merkle tree is to be persisted in a key value store. `LevelUp` provides the basic key value store interface.

## Building and Running

After cloning the repo:

```bash
yarn install

# To run all tests.
yarn test

# To run tests, watching for changes.
yarn test --watch
```
### [WIP] Thinking Process

Mantra: 1st make it work, 2nd make it right, 3rd make it fast.

1st Attempt: Create one big buffer to store the entire tree and use array indexes for fast navigation. Problem: The tree was too large to fit in memory. Additionally, I realized I could only modify specific parts of the code and understood the necessity of using the DB.

2nd Attempt: Use the configured DB and perform operations recursively. Problem: While specific changes were efficient (log2n), tree initialization caused max heap errors. I realized that since the root was deterministic, the entire tree was deterministic and could be built sequentially.

3rd Attempt: Initialize the tree sequentially by calculating only necessary parts. For updates and path calculations, I kept recursion. The tests passed successfully.

Other Problems I Encountered:
- Infinite Loop: A bug in the update logic caused incorrect child settings, leading to infinite loops due to repeated values. Debugging this was challenging.
- ShouldGoRight: Determining the correct path at each level was difficult. I found a formula online that worked, which involved traversing the tree from root to leaf and checking if the bit was 1 or 0.
- Debugging: For multiple bugs, it was faster to create temporary functions to print the tree and paths for debugging. These functions were removed after tests passed for cleaner code.

Future Work:
- Add extensive tests. Multiple internal functions with logic need unit testing.
- Reorganize the files: Separate the DB, tree, utilities, and tests into different files.

Author: x.com/mgrabina
