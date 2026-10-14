from PIL import Image
import os
import glob

# Paths
brain_dir = r"C:\Users\user\.gemini\antigravity-ide\brain\fcc9bf88-52e2-4f8d-af0d-1bff769cdfb3"
static_dir = r"C:\Users\user\Documents\SIM_WHEEL\static"
base_dir = r"C:\Users\user\Documents\SIM_WHEEL"

def make_transparent(img_path, out_path):
    print(f"Processing {img_path} -> {out_path}")
    img = Image.open(img_path).convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    # threshold for what is considered "white" background
    threshold = 240
    for item in datas:
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            # Change white to transparent
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    img.save(out_path, "PNG")

def process_wheels():
    scania_files = glob.glob(os.path.join(brain_dir, "scania_wheel_*.png"))
    if scania_files:
        make_transparent(scania_files[-1], os.path.join(static_dir, "scania_wheel.png"))
        
    volvo_files = glob.glob(os.path.join(brain_dir, "volvo_wheel_*.png"))
    if volvo_files:
        make_transparent(volvo_files[-1], os.path.join(static_dir, "volvo_wheel.png"))
        
    pedal_files = glob.glob(os.path.join(brain_dir, "pedal_plate_*.png"))
    if pedal_files:
        make_transparent(pedal_files[-1], os.path.join(static_dir, "pedal_plate.png"))

def process_icon():
    icon_files = glob.glob(os.path.join(brain_dir, "vforce_icon_*.png"))
    if icon_files:
        img = Image.open(icon_files[-1])
        icon_path = os.path.join(base_dir, "vforce.ico")
        img.save(icon_path, format="ICO", sizes=[(256, 256)])
        print(f"Saved {icon_path}")

if __name__ == "__main__":
    process_wheels()
    process_icon()
    print("Done processing assets.")
