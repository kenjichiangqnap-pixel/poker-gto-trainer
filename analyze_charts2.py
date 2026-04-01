"""
Analyze poker range chart images - refined grid detection and reading.
Page 3 has 8 RFI charts in 2 rows x 4 columns layout.
"""
import os, sys
from PIL import Image
import numpy as np

RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
IMG_DIR = r'C:\Users\kenji412\Documents\kenji_ai_test\poker-gto-trainer\pdf_pages'

def grid_to_hand(row, col):
    if row == col: return RANKS[row] + RANKS[col]
    if row < col: return RANKS[row] + RANKS[col] + 's'
    return RANKS[col] + RANKS[row] + 'o'

def find_grid_bounds(arr, x_start, x_end, y_start, y_end):
    """Find exact 13x13 grid bounds within a region by looking for grid lines."""
    region = arr[y_start:y_end, x_start:x_end]
    h, w = region.shape[:2]
    
    # Look for colored (non-white, non-gray) cells
    # Find first and last colored rows/cols
    colored = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            r, g, b = int(region[y,x,0]), int(region[y,x,1]), int(region[y,x,2])
            diff = max(r,g,b) - min(r,g,b)
            if diff > 30 and max(r,g,b) > 60:
                colored[y,x] = True
    
    # Find bounds of colored area
    rows_with_color = np.where(colored.any(axis=1))[0]
    cols_with_color = np.where(colored.any(axis=0))[0]
    
    if len(rows_with_color) == 0 or len(cols_with_color) == 0:
        return None
    
    gy = y_start + rows_with_color[0]
    gx = x_start + cols_with_color[0]
    gh = rows_with_color[-1] - rows_with_color[0]
    gw = cols_with_color[-1] - cols_with_color[0]
    
    return gx, gy, gw, gh

def classify_pixel(r, g, b):
    """Classify pixel color to action."""
    r, g, b = int(r), int(g), int(b)
    
    # White/light gray = fold or label
    if r > 220 and g > 220 and b > 220:
        return 'fold'
    # Very dark = grid line
    if r < 50 and g < 50 and b < 50:
        return 'line'
    
    # Compute which channel dominates
    mx = max(r, g, b)
    mn = min(r, g, b)
    sat = mx - mn
    
    if sat < 25:  # gray
        if mx > 160:
            return 'fold'
        return 'line'
    
    # Red/orange dominant = raise
    if r > g and r > b and r - g > 30:
        return 'raise'
    
    # Green dominant = call
    if g > r and g > b:
        return 'call'
    
    # Yellow (r~=g, both > b)
    if r > 150 and g > 120 and b < 120 and abs(r-g) < 60:
        return 'raise'
    
    # Blue = sometimes call/fold variant
    if b > r and b > g:
        return 'call'
    
    # Purple = sometimes raise variant
    if r > 100 and b > 100 and g < r and g < b:
        return 'raise'
    
    return 'fold'

def read_grid(arr, gx, gy, gw, gh, grid_size=13):
    """Read a 13x13 grid of actions."""
    cell_w = gw / grid_size
    cell_h = gh / grid_size
    
    results = {}
    for row in range(grid_size):
        for col in range(grid_size):
            # Sample 5x5 area in center of cell
            cx = int(gx + col * cell_w + cell_w * 0.5)
            cy = int(gy + row * cell_h + cell_h * 0.5)
            
            # Sample a small area
            votes = {'raise': 0, 'call': 0, 'fold': 0}
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    py, px = cy + dy, cx + dx
                    if 0 <= py < arr.shape[0] and 0 <= px < arr.shape[1]:
                        c = classify_pixel(arr[py,px,0], arr[py,px,1], arr[py,px,2])
                        if c in votes:
                            votes[c] += 1
            
            hand = grid_to_hand(row, col)
            action = max(votes, key=votes.get)
            results[hand] = action
    
    return results

def count_hands(results, action):
    """Count how many hands have a given action."""
    return sum(1 for v in results.values() if v == action)

def list_hands(results, action):
    """List hands with a given action, in rank order."""
    hand_order = []
    for r in range(13):
        for c in range(13):
            h = grid_to_hand(r, c)
            if results.get(h) == action:
                hand_order.append(h)
    return hand_order

# ============ Analyze Page 3: RFI ============
print("=" * 60)
print("ANALYZING PAGE 3: RFI (Raise First In)")
print("=" * 60)

img = Image.open(os.path.join(IMG_DIR, 'page_3.png'))
arr = np.array(img)
h, w = arr.shape[:2]

# Based on layout analysis:
# 4 columns: x=48-533, x=589-1079, x=1130-1615, x=1667-2152
# 2 rows visible from y bands
# Row 1 top charts, Row 2 bottom charts

# Let me scan for actual grid positions in each quadrant
col_ranges = [(48, 533), (589, 1079), (1130, 1615), (1667, 2152)]
row_ranges = [(100, 700), (800, 1500)]  # approximate row bands

chart_names_row1 = ['UTG', 'UTG+1', 'UTG+2', 'Lojack']
chart_names_row2 = ['Hijack', 'Cutoff', 'Button', 'Small Blind']

all_rfi = {}

for row_idx, (y1, y2) in enumerate(row_ranges):
    names = chart_names_row1 if row_idx == 0 else chart_names_row2
    for col_idx, (x1, x2) in enumerate(col_ranges):
        name = names[col_idx]
        bounds = find_grid_bounds(arr, x1, x2, y1, y2)
        if bounds:
            gx, gy, gw, gh = bounds
            results = read_grid(arr, gx, gy, gw, gh)
            raise_count = count_hands(results, 'raise')
            call_count = count_hands(results, 'call')
            total_play = raise_count + call_count
            pct = total_play / 169 * 100
            
            all_rfi[name] = results
            
            raise_hands = list_hands(results, 'raise')
            call_hands = list_hands(results, 'call')
            
            print(f"\n--- {name} RFI ---")
            print(f"  Grid at: ({gx},{gy}) size {gw}x{gh}")
            print(f"  Raise: {raise_count} hands ({raise_count/169*100:.1f}%)")
            if call_count > 0:
                print(f"  Call: {call_count} hands ({call_count/169*100:.1f}%)")
            print(f"  Total playable: {total_play} ({pct:.1f}%)")
            print(f"  Raise hands: {', '.join(raise_hands[:20])}{'...' if len(raise_hands) > 20 else ''}")
        else:
            print(f"\n--- {name} RFI --- GRID NOT FOUND in region ({x1},{y1})-({x2},{y2})")

# Quick color sample to understand what colors mean
print("\n\n=== COLOR SAMPLES FROM FIRST CHART (UTG) ===")
if 'UTG' in all_rfi:
    bounds = find_grid_bounds(arr, 48, 533, 100, 700)
    if bounds:
        gx, gy, gw, gh = bounds
        cell_w = gw / 13
        cell_h = gh / 13
        # Sample AA (0,0), 72o (bottom-right area), and a mid-range hand
        for hand_label, row, col in [('AA', 0, 0), ('AKs', 0, 1), ('KK', 1, 1), ('T9s', 4, 5), ('72o', 12, 11), ('65s', 7, 8), ('32o', 12, 12)]:
            cx = int(gx + col * cell_w + cell_w * 0.5)
            cy = int(gy + row * cell_h + cell_h * 0.5)
            r, g, b = arr[cy, cx, 0], arr[cy, cx, 1], arr[cy, cx, 2]
            action = classify_pixel(r, g, b)
            print(f"  {hand_label} ({row},{col}): RGB=({r},{g},{b}) -> {action}")
