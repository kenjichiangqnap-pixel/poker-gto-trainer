"""
Refined chart analysis with better grid detection.
Uses contiguous colored region detection to find exact cell boundaries.
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

def is_colored(r, g, b):
    """Is this pixel a chart cell (not white, not black grid line, not gray background)?"""
    r, g, b = int(r), int(g), int(b)
    mx = max(r, g, b)
    mn = min(r, g, b)
    # Exclude near-white (background/fold)
    if mx > 235 and mn > 235:
        return False
    # Exclude near-black (grid lines/text)
    if mx < 40:
        return False
    # Exclude dark gray (grid lines)
    if mx < 80 and (mx - mn) < 20:
        return False
    # Must have some saturation (colored cell)
    if (mx - mn) > 25:
        return True
    # Medium gray could be a light colored cell
    if mx > 120 and mn > 80:
        return True
    return False

def classify_action(r, g, b):
    """Classify a cell color to action. PokerCoaching uses:
    - Red/orange/salmon = Raise/Open
    - Green/teal = Call
    - Blue = sometimes used for specific actions
    - Light/white = Fold
    """
    r, g, b = int(r), int(g), int(b)
    mx = max(r, g, b)
    mn = min(r, g, b)
    
    # Very light = fold
    if mx > 220 and mn > 200:
        return 'fold'
    # Near-black = grid line, treat as unknown
    if mx < 50:
        return 'unknown'
    
    sat = mx - mn
    
    # Low saturation gray
    if sat < 30:
        if mx > 160: return 'fold'
        return 'unknown'
    
    # Find dominant channel
    if r >= g and r >= b:
        # Red dominant - could be raise, or salmon/pink
        if g > 150 and b < 100:  # yellow-ish
            return 'raise'
        if r > 150:
            return 'raise'
        return 'raise'
    elif g >= r and g >= b:
        # Green dominant = call
        return 'call'
    else:
        # Blue dominant
        if b > 150 and r < 100 and g < 100:
            return 'fold'  # dark blue sometimes = fold variant
        return 'call'  # light blue sometimes = call

def analyze_chart_region(arr, x1, x2, y1, y2, label=""):
    """
    Find and read a 13x13 chart in the given region.
    Uses column/row scanning to find cell boundaries.
    """
    region = arr[y1:y2, x1:x2]
    h, w = region.shape[:2]
    
    # Create color mask
    cmask = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            cmask[y, x] = is_colored(region[y,x,0], region[y,x,1], region[y,x,2])
    
    # Find grid by looking at column-wise density
    col_density = cmask.sum(axis=0)
    row_density = cmask.sum(axis=1)
    
    # Find the main colored block
    col_thresh = h * 0.15
    row_thresh = w * 0.15
    
    active_cols = np.where(col_density > col_thresh)[0]
    active_rows = np.where(row_density > row_thresh)[0]
    
    if len(active_cols) < 10 or len(active_rows) < 10:
        return None
    
    gx_local = active_cols[0]
    gx_end = active_cols[-1]
    gy_local = active_rows[0]
    gy_end = active_rows[-1]
    
    grid_w = gx_end - gx_local
    grid_h = gy_end - gy_local
    
    # Now find the 13 cell boundaries by looking for dips in density (grid lines)
    # Scan columns within the grid area
    col_profile = cmask[gy_local:gy_end, gx_local:gx_end].sum(axis=0)
    row_profile = cmask[gy_local:gy_end, gx_local:gx_end].sum(axis=1)
    
    def find_cell_centers(profile, n_cells=13):
        """Find n_cells cell centers by finding dips (grid lines) in the profile."""
        # Grid lines appear as dips in colored pixel density
        avg = profile.mean()
        threshold = avg * 0.3
        
        # Find regions above threshold (cells) and below (lines)
        cell_regions = []
        in_cell = False
        start = 0
        for i, v in enumerate(profile):
            if v > threshold and not in_cell:
                start = i
                in_cell = True
            elif (v <= threshold or i == len(profile)-1) and in_cell:
                end = i if v <= threshold else i + 1
                if end - start > 3:  # minimum cell size
                    cell_regions.append((start, end))
                in_cell = False
        
        # If we got roughly 13 regions, use their centers
        if len(cell_regions) >= n_cells - 1:
            centers = [(s + e) // 2 for s, e in cell_regions[:n_cells]]
            return centers
        
        # Fallback: divide evenly
        cell_size = len(profile) / n_cells
        return [int((i + 0.5) * cell_size) for i in range(n_cells)]
    
    col_centers = find_cell_centers(col_profile)
    row_centers = find_cell_centers(row_profile)
    
    # Now sample each cell
    results = {}
    color_samples = {}
    
    abs_gx = x1 + gx_local
    abs_gy = y1 + gy_local
    
    for ri, ry in enumerate(row_centers):
        for ci, cx_val in enumerate(col_centers):
            hand = grid_to_hand(ri, ci)
            
            # Sample a 7x7 area centered on the cell center
            sample_x = abs_gx + cx_val
            sample_y = abs_gy + ry
            
            r_sum, g_sum, b_sum, count = 0, 0, 0, 0
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    py = sample_y + dy
                    px = sample_x + dx
                    if 0 <= py < arr.shape[0] and 0 <= px < arr.shape[1]:
                        pr, pg, pb = int(arr[py,px,0]), int(arr[py,px,1]), int(arr[py,px,2])
                        # Skip grid lines (very dark)
                        if max(pr, pg, pb) > 50:
                            r_sum += pr
                            g_sum += pg
                            b_sum += pb
                            count += 1
            
            if count > 0:
                avg_r = r_sum // count
                avg_g = g_sum // count
                avg_b = b_sum // count
                action = classify_action(avg_r, avg_g, avg_b)
                results[hand] = action
                color_samples[hand] = (avg_r, avg_g, avg_b)
            else:
                results[hand] = 'fold'
                color_samples[hand] = (255, 255, 255)
    
    return results, color_samples

def print_chart_summary(label, results, color_samples=None, show_colors=False):
    """Print summary of a chart's ranges."""
    if results is None:
        print(f"\n--- {label} --- NOT FOUND")
        return
    
    raise_hands = [h for h in results if results[h] == 'raise']
    call_hands = [h for h in results if results[h] == 'call']
    fold_hands = [h for h in results if results[h] == 'fold']
    unknown_hands = [h for h in results if results[h] == 'unknown']
    
    raise_count = len(raise_hands)
    call_count = len(call_hands)
    total_play = raise_count + call_count
    
    print(f"\n--- {label} ---")
    print(f"  Raise: {raise_count} hands ({raise_count/169*100:.1f}%)")
    if call_count > 0:
        print(f"  Call: {call_count} hands ({call_count/169*100:.1f}%)")
    print(f"  Fold: {len(fold_hands)} ({len(fold_hands)/169*100:.1f}%)")
    if unknown_hands:
        print(f"  Unknown: {len(unknown_hands)} ({len(unknown_hands)/169*100:.1f}%)")
    print(f"  Total playable: {total_play} ({total_play/169*100:.1f}%)")
    
    # Print in hand ranking order for readability
    if raise_hands:
        print(f"  Raise: {', '.join(sorted(raise_hands, key=lambda h: HAND_RANKINGS.index(h) if h in HAND_RANKINGS else 999)[:30])}")
    if call_hands:
        print(f"  Call: {', '.join(sorted(call_hands, key=lambda h: HAND_RANKINGS.index(h) if h in HAND_RANKINGS else 999)[:30])}")
    
    if show_colors and color_samples:
        # Show a few samples
        for h in ['AA', 'KK', 'AKs', 'T9s', '72o', '54s']:
            if h in color_samples:
                r, g, b = color_samples[h]
                print(f"    {h}: RGB=({r},{g},{b}) -> {results[h]}")

HAND_RANKINGS = [
  'AA','KK','QQ','JJ','AKs','TT','AQs','AKo','AJs','KQs',
  '99','ATs','KJs','AQo','QJs','KTs','88','A9s','JTs','KQo',
  'A8s','K9s','T9s','QTs','A7s','77','A5s','A6s','A4s','J9s',
  'AJo','Q9s','A3s','98s','KJo','66','A2s','K8s','T8s','87s',
  'QJo','ATo','K7s','97s','76s','55','KTo','K6s','65s','J8s',
  '86s','A9o','K5s','54s','Q8s','75s','44','K4s','T7s','96s',
  'J7s','QTo','A8o','K3s','64s','85s','33','K2s','Q7s','53s',
  'J9o','Q6s','22','43s','J6s','63s','T6s','T9o','A7o','A6o',
  'Q5s','T5s','98o','A5o','95s','Q4s','J5s','84s','52s','42s',
  'K9o','A4o','Q3s','87o','J8o','A3o','Q2s','K8o','T8o','JTo',
  '97o','76o','A2o','Q9o','J4s','65o','J3s','86o','T4s','J2s',
  '54o','K7o','96o','T3s','75o','T2s','64o','94s','93s','K6o',
  '85o','92s','53o','Q8o','K5o','83s','74s','73s','J7o','43o',
  'T7o','K4o','82s','72s','Q7o','74o','K3o','Q6o','63o','62s',
  '32s','K2o','J6o','95o','T6o','Q5o','84o','52o','42o','J5o',
  'Q4o','73o','Q3o','62o','T5o','J4o','32o','Q2o','J3o','T4o',
  'J2o','94o','93o','T3o','92o','T2o','83o','82o','72o'
]

# ============ Page 3: RFI ============
print("=" * 70)
print("PAGE 3: RFI (Raise First In) — 100BB+")
print("=" * 70)

img = Image.open(os.path.join(IMG_DIR, 'page_3.png'))
arr = np.array(img)

col_ranges = [(48, 533), (589, 1079), (1130, 1615), (1667, 2152)]
rfi_positions_r1 = ['UTG', 'UTG+1', 'UTG+2', 'Lojack']
rfi_positions_r2 = ['Hijack', 'Cutoff', 'Button', 'Small Blind']

for ridx, (y1, y2, names) in enumerate([
    (100, 700, rfi_positions_r1),
    (800, 1600, rfi_positions_r2)
]):
    for cidx, (x1, x2) in enumerate(col_ranges):
        name = names[cidx]
        result = analyze_chart_region(arr, x1, x2, y1, y2, name)
        if result:
            results, colors = result
            print_chart_summary(name, results, colors, show_colors=(name in ['UTG', 'Button']))
        else:
            print(f"\n--- {name} --- NOT DETECTED")
