// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Sherwood Canvas — an on-chain pixel war on Robinhood Chain
/// @notice A shared 64×64 canvas. Paint a free pixel for BASE_PRICE; take someone else's pixel for double what they
///         paid (capped at 256× BASE_PRICE). Half of every takeover goes to the pixel's previous owner — defending
///         territory pays — and half to the season treasury. Payouts are pull-based (withdraw), never pushed.
contract SherwoodCanvas {
    uint256 public constant SIZE = 64;
    uint256 public constant PIXELS = SIZE * SIZE; // 4096
    uint256 public constant BASE_PRICE = 0.00001 ether;
    uint8 public constant MAX_LEVEL = 8; // price stops doubling at 256 × BASE_PRICE
    uint256 public constant MAX_BATCH = 64;

    struct Pixel {
        address owner;
        uint24 color;
        uint8 level; // how many times it was taken over; next price = BASE_PRICE << level
    }

    Pixel[PIXELS] private pixels;
    mapping(address => uint256) public owned; // pixels currently held
    mapping(address => uint256) public credit; // withdrawable ETH
    uint256 public treasury;
    uint256 public totalPaints;
    address public immutable keeper;

    event Painted(uint256 indexed id, address indexed painter, address indexed previousOwner, uint24 color, uint256 price);
    event Withdrawn(address indexed who, uint256 amount);

    error BadBatch();
    error BadPixel(uint256 id);
    error NotEnough(uint256 needed, uint256 sent);
    error NothingToWithdraw();
    error OnlyKeeper();
    error TransferFailed();

    constructor() {
        keeper = msg.sender;
    }

    /// @notice price to paint pixel `id` right now
    function priceOf(uint256 id) public view returns (uint256) {
        if (id >= PIXELS) revert BadPixel(id);
        Pixel storage p = pixels[id];
        return p.owner == address(0) ? BASE_PRICE : BASE_PRICE << p.level;
    }

    /// @notice total price of a batch (what the site shows before you confirm)
    function quote(uint256[] calldata ids) external view returns (uint256 total) {
        for (uint256 i = 0; i < ids.length; i++) total += priceOf(ids[i]);
    }

    /// @notice paint up to 64 pixels; any overpayment is refunded to your withdrawable credit
    function paint(uint256[] calldata ids, uint24[] calldata colors) external payable {
        uint256 n = ids.length;
        if (n == 0 || n > MAX_BATCH || colors.length != n) revert BadBatch();
        uint256 spent;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ids[i];
            uint256 price = priceOf(id); // reverts on a bad id
            Pixel storage p = pixels[id];
            address prev = p.owner;
            if (prev == address(0)) {
                treasury += price;
            } else {
                uint256 half = price / 2;
                credit[prev] += half;
                treasury += price - half;
                owned[prev] -= 1;
                if (p.level < MAX_LEVEL) p.level += 1;
            }
            p.owner = msg.sender;
            p.color = colors[i];
            owned[msg.sender] += 1;
            spent += price;
            emit Painted(id, msg.sender, prev, colors[i], price);
        }
        if (msg.value < spent) revert NotEnough(spent, msg.value);
        if (msg.value > spent) credit[msg.sender] += msg.value - spent;
        totalPaints += n;
    }

    /// @notice collect what you earned from takeovers (and any overpayment)
    function withdraw() external {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credit[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice the season treasury — for prizes / community rewards
    function withdrawTreasury(address to, uint256 amount) external {
        if (msg.sender != keeper) revert OnlyKeeper();
        treasury -= amount; // reverts on underflow
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice colours of pixels [from, from+count) packed as 3 bytes each (the whole canvas = 12 KB in one call)
    function colorsRange(uint256 from, uint256 count) external view returns (bytes memory out) {
        if (from + count > PIXELS) revert BadPixel(from + count);
        out = new bytes(count * 3);
        for (uint256 i = 0; i < count; i++) {
            uint24 c = pixels[from + i].color;
            out[i * 3] = bytes1(uint8(c >> 16));
            out[i * 3 + 1] = bytes1(uint8(c >> 8));
            out[i * 3 + 2] = bytes1(uint8(c));
        }
    }

    /// @notice owners + levels of pixels [from, from+count)
    function pixelsRange(uint256 from, uint256 count) external view returns (address[] memory owners, uint8[] memory levels) {
        if (from + count > PIXELS) revert BadPixel(from + count);
        owners = new address[](count);
        levels = new uint8[](count);
        for (uint256 i = 0; i < count; i++) {
            owners[i] = pixels[from + i].owner;
            levels[i] = pixels[from + i].level;
        }
    }
}
