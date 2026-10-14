import sys

PLATFORM = sys.platform  # 'win32' on Windows, 'linux' on Linux


class SimController:
    def __init__(self, profiles_data):
        self.profiles_data = profiles_data
        self.connected = False

        if PLATFORM == "win32":
            self._init_windows()
        else:
            self._init_linux()

    # ------------------------------------------------------------------
    # Windows — ViGEmBus / vgamepad
    # ------------------------------------------------------------------
    def _init_windows(self):
        import vgamepad as vg
        self._vg = vg
        try:
            self.gamepad = vg.VX360Gamepad()
            self.connected = True
            print("Virtual Xbox 360 controller initialized (ViGEmBus).")
        except Exception as e:
            print(f"Error initialising ViGEmBus: {e}")
            self.connected = False
            return

        self.BUTTON_ENUMS = {
            "BUTTON_A":     vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
            "BUTTON_B":     vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
            "BUTTON_X":     vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
            "BUTTON_Y":     vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
            "BUTTON_LB":    vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
            "BUTTON_RB":    vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
            "BUTTON_BACK":  vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
            "BUTTON_START": vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
            "BUTTON_L3":    vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB,
            "BUTTON_R3":    vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB,
            "DPAD_UP":      vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
            "DPAD_DOWN":    vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
            "DPAD_LEFT":    vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
            "DPAD_RIGHT":   vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
        }

    # ------------------------------------------------------------------
    # Linux — uinput via python-evdev
    # ------------------------------------------------------------------
    def _init_linux(self):
        try:
            from evdev import UInput, AbsInfo, ecodes as e
            self._e = e

            ABS_MAX_STICK   = 32767
            ABS_MAX_TRIGGER = 255

            cap = {
                e.EV_KEY: [
                    e.BTN_A, e.BTN_B, e.BTN_X, e.BTN_Y,
                    e.BTN_TL, e.BTN_TR,
                    e.BTN_SELECT, e.BTN_START,
                    e.BTN_THUMBL, e.BTN_THUMBR,
                ],
                e.EV_ABS: [
                    (e.ABS_X,     AbsInfo(value=0, min=-ABS_MAX_STICK,   max=ABS_MAX_STICK,   fuzz=16, flat=128, resolution=0)),
                    (e.ABS_Y,     AbsInfo(value=0, min=-ABS_MAX_STICK,   max=ABS_MAX_STICK,   fuzz=16, flat=128, resolution=0)),
                    (e.ABS_RX,    AbsInfo(value=0, min=-ABS_MAX_STICK,   max=ABS_MAX_STICK,   fuzz=16, flat=128, resolution=0)),
                    (e.ABS_RY,    AbsInfo(value=0, min=-ABS_MAX_STICK,   max=ABS_MAX_STICK,   fuzz=16, flat=128, resolution=0)),
                    (e.ABS_Z,     AbsInfo(value=0, min=0,                max=ABS_MAX_TRIGGER, fuzz=0,  flat=0,   resolution=0)),
                    (e.ABS_RZ,    AbsInfo(value=0, min=0,                max=ABS_MAX_TRIGGER, fuzz=0,  flat=0,   resolution=0)),
                    (e.ABS_HAT0X, AbsInfo(value=0, min=-1,               max=1,               fuzz=0,  flat=0,   resolution=0)),
                    (e.ABS_HAT0Y, AbsInfo(value=0, min=-1,               max=1,               fuzz=0,  flat=0,   resolution=0)),
                ],
            }

            self.gamepad = UInput(cap, name="VForce Virtual Gamepad", vendor=0x045e, product=0x028e, version=0x110)
            self.connected = True
            print("Virtual gamepad created via uinput (Linux).")
        except Exception as ex:
            print(f"Error creating uinput device: {ex}")
            print("  Hint: make sure the 'uinput' kernel module is loaded:  sudo modprobe uinput")
            print("  and your user has write access to /dev/uinput.")
            self.connected = False
            return

        e = self._e
        # Map logical button names -> evdev BTN_ codes (None = handled via hat axis)
        self.BUTTON_ENUMS = {
            "BUTTON_A":     e.BTN_A,
            "BUTTON_B":     e.BTN_B,
            "BUTTON_X":     e.BTN_X,
            "BUTTON_Y":     e.BTN_Y,
            "BUTTON_LB":    e.BTN_TL,
            "BUTTON_RB":    e.BTN_TR,
            "BUTTON_BACK":  e.BTN_SELECT,
            "BUTTON_START": e.BTN_START,
            "BUTTON_L3":    e.BTN_THUMBL,
            "BUTTON_R3":    e.BTN_THUMBR,
            "DPAD_UP":      None,
            "DPAD_DOWN":    None,
            "DPAD_LEFT":    None,
            "DPAD_RIGHT":   None,
        }

    # ------------------------------------------------------------------
    # Shared public API
    # ------------------------------------------------------------------
    def update_profiles(self, data):
        self.profiles_data = data

    def process_input(self, data):
        if not self.connected:
            return
        if PLATFORM == "win32":
            self._process_windows(data)
        else:
            self._process_linux(data)

    # ------------------------------------------------------------------
    # Windows input processing
    # ------------------------------------------------------------------
    def _process_windows(self, data):
        axes    = data.get("axes", {})
        buttons = data.get("buttons", {})

        left_x = left_y = right_x = right_y = 0.0
        left_trigger = right_trigger = 0.0

        for btn_enum in self.BUTTON_ENUMS.values():
            self.gamepad.release_button(button=btn_enum)

        active_id      = self.profiles_data.get("active_profile", "default")
        active_profile = self.profiles_data.get("profiles", {}).get(active_id, {})
        mappings       = active_profile.get("mappings", {})

        for element_id, val in axes.items():
            mapped_output = mappings.get(element_id, {}).get("output")
            if not mapped_output:
                continue
            v = float(val)
            if   mapped_output == "LEFT_STICK_X":   left_x        = v
            elif mapped_output == "LEFT_STICK_Y":   left_y        = v
            elif mapped_output == "RIGHT_STICK_X":  right_x       = v
            elif mapped_output == "RIGHT_STICK_Y":  right_y       = v
            elif mapped_output == "LEFT_TRIGGER":   left_trigger  = v
            elif mapped_output == "RIGHT_TRIGGER":  right_trigger = v

        for element_id, is_pressed in buttons.items():
            if not is_pressed:
                continue
            mapped_output = mappings.get(element_id, {}).get("output")
            if mapped_output and mapped_output in self.BUTTON_ENUMS:
                self.gamepad.press_button(button=self.BUTTON_ENUMS[mapped_output])

        self.gamepad.left_joystick_float(x_value_float=left_x,    y_value_float=left_y)
        self.gamepad.right_joystick_float(x_value_float=right_x,  y_value_float=right_y)
        self.gamepad.left_trigger_float(value_float=left_trigger)
        self.gamepad.right_trigger_float(value_float=right_trigger)
        self.gamepad.update()

    # ------------------------------------------------------------------
    # Linux input processing (evdev / uinput)
    # ------------------------------------------------------------------
    def _process_linux(self, data):
        e = self._e
        ABS_MAX_STICK   = 32767
        ABS_MAX_TRIGGER = 255

        axes    = data.get("axes", {})
        buttons = data.get("buttons", {})

        active_id      = self.profiles_data.get("active_profile", "default")
        active_profile = self.profiles_data.get("profiles", {}).get(active_id, {})
        mappings       = active_profile.get("mappings", {})

        left_x = left_y = right_x = right_y = 0.0
        left_trigger = right_trigger = 0.0
        hat_x = hat_y = 0

        # Reset all digital buttons
        for btn_code in self.BUTTON_ENUMS.values():
            if btn_code is not None:
                self.gamepad.write(e.EV_KEY, btn_code, 0)

        for element_id, val in axes.items():
            mapped_output = mappings.get(element_id, {}).get("output")
            if not mapped_output:
                continue
            v = float(val)
            if   mapped_output == "LEFT_STICK_X":  left_x        = v
            elif mapped_output == "LEFT_STICK_Y":  left_y        = v
            elif mapped_output == "RIGHT_STICK_X": right_x       = v
            elif mapped_output == "RIGHT_STICK_Y": right_y       = v
            elif mapped_output == "LEFT_TRIGGER":  left_trigger  = v
            elif mapped_output == "RIGHT_TRIGGER": right_trigger = v

        for element_id, is_pressed in buttons.items():
            if not is_pressed:
                continue
            mapped_output = mappings.get(element_id, {}).get("output")
            if not mapped_output:
                continue
            if mapped_output in self.BUTTON_ENUMS:
                btn_code = self.BUTTON_ENUMS[mapped_output]
                if btn_code is not None:
                    self.gamepad.write(e.EV_KEY, btn_code, 1)
                # D-pad via hat axis
                elif mapped_output == "DPAD_UP":    hat_y = -1
                elif mapped_output == "DPAD_DOWN":  hat_y =  1
                elif mapped_output == "DPAD_LEFT":  hat_x = -1
                elif mapped_output == "DPAD_RIGHT": hat_x =  1

        # Write analog axes (Y axes are inverted on Linux)
        self.gamepad.write(e.EV_ABS, e.ABS_X,     int(left_x        * ABS_MAX_STICK))
        self.gamepad.write(e.EV_ABS, e.ABS_Y,     int(-left_y       * ABS_MAX_STICK))
        self.gamepad.write(e.EV_ABS, e.ABS_RX,    int(right_x       * ABS_MAX_STICK))
        self.gamepad.write(e.EV_ABS, e.ABS_RY,    int(-right_y      * ABS_MAX_STICK))
        self.gamepad.write(e.EV_ABS, e.ABS_Z,     int(left_trigger  * ABS_MAX_TRIGGER))
        self.gamepad.write(e.EV_ABS, e.ABS_RZ,    int(right_trigger * ABS_MAX_TRIGGER))
        self.gamepad.write(e.EV_ABS, e.ABS_HAT0X, hat_x)
        self.gamepad.write(e.EV_ABS, e.ABS_HAT0Y, hat_y)

        # Sync — flush all buffered events to the kernel at once
        self.gamepad.syn()
