import { LevelUp, LevelUpChain } from 'levelup';
import { HashPath } from './hash_path';
import { Sha256Hasher } from './sha256_hasher';

const MAX_DEPTH = 32;
const LEAF_BYTES = 64; // All leaf values are 64 bytes.

/**
 * The merkle tree, in summary, is a data structure with a number of indexable elements, and the property
 * that it is possible to provide a succinct proof (HashPath) that a given piece of data, exists at a certain index,
 * for a given merkle tree root.
 */
export class MerkleTree {
  private hasher = new Sha256Hasher();
  private root = Buffer.alloc(32);

  /**
   * Constructs a new MerkleTree instance, either initializing an empty tree, or restoring pre-existing state values.
   * Use the async static `new` function to construct.
   *
   * @param db Underlying leveldb.
   * @param name Name of the tree, to be used when restoring/persisting state.
   * @param depth The depth of the tree, to be no greater than MAX_DEPTH.
   * @param root When restoring, you need to provide the root.
   */
  constructor(private db: LevelUp, private name: string, private depth: number, root?: Buffer) {
    if (!(depth >= 1 && depth <= MAX_DEPTH)) {
      throw Error('Bad depth');
    }

    if (root) {
      // Restore already saved tree state.
      root.copy(this.root);
    } else {
      // Since initialization with zeros is deterministic, we do it sequentially for enhanced performance.
      const hashPerLevel: Buffer[] = [];
      for (let i = depth; i >= 0; i--) {
        // Get deterministic hash for current level
        if (this.depth === i) {
          // Leaf nodes are initialized with zeros and hash is calculated from it.
          const buffer = Buffer.alloc(64, 0);
          const hash = this.hasher.hash(buffer);
          hashPerLevel[i] = hash;
        } else {
          // For internal nodes, hash is calculated from children.
          if (!hashPerLevel[i + 1]) {
            throw new Error("Hash not found for level " + (i + 1));
          }

          const childHash = hashPerLevel[i + 1];
          const combinedHash = this.hasher.compress(
            childHash, // left
            childHash // right
          );
          hashPerLevel[i] = combinedHash;

          const levelBuffer = Buffer.alloc(64);
          childHash.copy(levelBuffer, 0);
          childHash.copy(levelBuffer, 32);

          // Save nodes, just one instance per level needed.
          this.db.put(combinedHash, levelBuffer);
        }
      }

      hashPerLevel[0].copy(this.root); // Copy the new root hash.
    }
  }

  /**
   * Constructs or restores a new MerkleTree instance with the given `name` and `depth`.
   * The `db` contains the tree data.
   */
  static async new(db: LevelUp, name: string, depth = MAX_DEPTH) {
    const meta: Buffer = await db.get(Buffer.from(name)).catch(() => {});
    if (meta) {
      const root = meta.slice(0, 32);
      const depth = meta.readUInt32LE(32);
      return new MerkleTree(db, name, depth, root);
    } else {
      const tree = new MerkleTree(db, name, depth);
      await tree.writeMetaData();
      return tree;
    }
  }

  private async writeMetaData(batch?: LevelUpChain<string, Buffer>) {
    const data = Buffer.alloc(40);
    this.root.copy(data);
    data.writeUInt32LE(this.depth, 32);
    if (batch) {
      batch.put(this.name, data);
    } else {
      await this.db.put(this.name, data);
    }
  }

  getRoot() {
    return this.root;
  }

  /**
   * Returns the hash path for `index`.
   * e.g. To return the HashPath for index 2, return the nodes marked `*` at each layer.
   *     d0:                                            [ root ]
   *     d1:                      [*]                                               [*]
   *     d2:         [*]                      [*]                       [ ]                     [ ]
   *     d3:   [ ]         [ ]          [*]         [*]           [ ]         [ ]          [ ]        [ ]
   */
  async getHashPath(index: number) {
    const getHashPathRecursively = async (
      current: Buffer,
      depth: number
    ): Promise<Buffer[][]> => {
      // DB values are stored as [left, right] pairs asigned to the parent hash.
      const fromDb: Buffer = await this.db.get(current);
      const leftHash = fromDb.slice(0, 32);
      const rightHash = fromDb.slice(32, 64);

      if (this.depth === depth + 1) {
        // If next level is leaf, we add both children to the beginning of the path and return.
        return [[leftHash, rightHash]];
      }

      const shouldGoRight = (index >> (this.depth - depth - 1)) & 1; // 1 if right, 0 if left. This works because we are traversing the tree from the root to the leaf.
      const accPath = await getHashPathRecursively(
        shouldGoRight ? rightHash : leftHash,
        depth + 1
      );

      accPath.push([leftHash, rightHash]);

      return accPath;
    };

    return new HashPath(await getHashPathRecursively(this.root, 0));
  }

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   */
  async updateElement(index: number, value: Buffer) {
    const updateRecursively = async (
      current: Buffer,
      depth: number
    ): Promise<Buffer> => {
      if (this.depth === depth) {
        // Leaf node, hash the value and return.
        return this.hasher.hash(value);
      }

      const fromDb: Buffer = await this.db.get(current);
      const shouldGoRight = (index >> (this.depth - depth - 1)) & 1; // 1 if right, 0 if left. This works because we are traversing the tree from the root to the leaf.

      const leftHash = shouldGoRight
        ? fromDb.slice(0, 32)
        : await updateRecursively(fromDb.slice(0, 32), depth + 1);
      const rightHash = shouldGoRight
        ? await updateRecursively(fromDb.slice(32, 64), depth + 1)
        : fromDb.slice(32, 64);

      // Save new internal node. Hash of children is calculated and saved.
      const newHash = this.hasher.compress(leftHash, rightHash);
      const newChildrenBuffer = Buffer.alloc(64);
      leftHash.copy(newChildrenBuffer, 0);
      rightHash.copy(newChildrenBuffer, 32);
      this.db.put(newHash, newChildrenBuffer);


      return newHash;
    };

    (await updateRecursively(this.root, 0)).copy(this.root); // Update the root.

    await this.writeMetaData(); // Persist the new root for future restores.

    return this.root;
  }
}
