import { LevelUp, LevelUpChain } from "levelup";
import { HashPath } from "./hash_path";
import { Sha256Hasher } from "./sha256_hasher";

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
  constructor(
    private db: LevelUp,
    private name: string,
    private depth: number,
    root?: Buffer
  ) {
    if (!(depth >= 1 && depth <= MAX_DEPTH)) {
      throw Error("Bad depth");
    }

    // [hash] : [left+right]
    // [hash] : [parent+left+right]

    if (root) {
      this.root = root;
    } else {
      const nodes: Buffer[] = [];
      const isLeaf = (i: number) => i === depth;
      for (let i = depth; i >= 0; i--) {
        nodes[i] = isLeaf(i)
          ? this.hasher.hash(Buffer.alloc(64))
          : this.hasher.compress(nodes[i + 1], nodes[i + 1]);

        if (!isLeaf(i)) {
          const hashKey = nodes[i];
          const hashValue = Buffer.concat([nodes[i + 1], nodes[i + 1]]);

          db.put(hashKey, hashValue).catch(() => {
            throw Error("Failed to write to db");
          });
        }
      }
      this.writeMetaData().catch(() => {
        throw Error("Failed to write metadata");
      });
      this.root = nodes[0];
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
    const hashPath: Buffer[][] = [];
    const getHashPathRecursive = async (current: Buffer, depth: number) => {
      if (this.isLeaf(depth)) {
        // If leaf, return;

        return;
      }

      // 1 if right, 0 if left. This works because we are traversing the tree from the root to the leaf.
      const parent = (await this.db.get(current)) as Buffer; // todo: use type verifications
      const left = parent.slice(0, 32);
      const right = parent.slice(32, 64);
      const shouldGoRight = (index >> (this.depth - depth - 1)) & 1;

      if (shouldGoRight) {
        await getHashPathRecursive(right, depth + 1);
      } else {
        await getHashPathRecursive(left, depth + 1);
      }

      hashPath.push([left, right]);
    };

    hashPath.forEach((hash) => {
      
    });

    await getHashPathRecursive(this.root, 0);

    return new HashPath(hashPath);
  }

  isLeaf(index: number) {
    return this.depth == index;
  }

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   */
  async updateElement(index: number, value: Buffer) {
    // Index de la hoja
    // Encuentr la hoja
    // Modifico
    // Subo a modificar Padres
    // Actualizo Root

    const updateRecursive = async (current: Buffer, depth: number) => {
      if (this.isLeaf(depth)) {
        // If leaf, update the value
        const newHash = this.hasher.hash(value);
        return newHash;
      }

      // 1 if right, 0 if left. This works because we are traversing the tree from the root to the leaf.
      const parent = (await this.db.get(current)) as Buffer; // todo: use type verifications
      const left = parent.slice(0, 32);
      const right = parent.slice(32, 64);
      const shouldGoRight = (index >> (this.depth - depth - 1)) & 1;

      let newChildHash: Buffer,
        compressedHash: Buffer,
        newParentDbValue: Buffer;
      if (shouldGoRight) {
        newChildHash = await updateRecursive(right, depth + 1);
        compressedHash = this.hasher.compress(left, newChildHash);
        newParentDbValue = Buffer.concat([left, newChildHash]);
      } else {
        newChildHash = await updateRecursive(left, depth + 1);
        compressedHash = this.hasher.compress(newChildHash, right);
        newParentDbValue = Buffer.concat([newChildHash, right]);
      }

      await this.db.put(compressedHash, newParentDbValue);

      return compressedHash;
    };

    this.root = await updateRecursive(this.root, 0);
    await this.writeMetaData()

    return this.root;
  }
}
