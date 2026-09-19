"""Local file picker; shares the CLI extraction core. No HTTP service."""
import datetime
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox
from extract import export_wordlist


def launch():
    root = tk.Tk()
    root.title("HHPLMS Word List export")
    fields = {}
    for index, (key, title, default) in enumerate([
        ("swf", "SWF file", ""), ("audio", "Word List audio root", ""), ("output", "Export parent directory", ""),
        ("book", "Source book slug", "ultimate-b2"), ("edition", "Source edition provenance", "greek")]):
        tk.Label(root, text=title).grid(row=index, column=0, sticky="w")
        fields[key] = tk.StringVar(value=default)
        tk.Entry(root, textvariable=fields[key], width=65).grid(row=index, column=1)
        if key in ("swf", "audio", "output"):
            def choose(name=key):
                value = filedialog.askopenfilename(filetypes=[("SWF", "*.swf")]) if name == "swf" else filedialog.askdirectory()
                if value:
                    fields[name].set(value)
            tk.Button(root, text="Choose…", command=choose).grid(row=index, column=2)
    status = tk.StringVar(value="Creates a fresh local export. Does not import or publish to Builder.")
    tk.Label(root, textvariable=status, wraplength=650).grid(row=6, columnspan=3)

    def export():
        values = {key: value.get() for key, value in fields.items()}
        if not all(values.values()):
            messagebox.showerror("Missing fields", "Select all inputs and explicit provenance.")
            return
        button.config(state="disabled")
        status.set("Reading SWF data and copying referenced audio…")
        def work():
            try:
                destination = Path(values["output"]) / datetime.datetime.now().strftime("wordlist-%Y%m%d-%H%M%S-%f")
                audit = export_wordlist(Path(values["swf"]), Path(values["audio"]), destination, values["book"], values["edition"])
                message = f"Exported and validated {audit['entries']} entries to {destination}. No hosted import was performed."
            except Exception as error:
                message = f"Export failed: {error}"
            root.after(0, lambda: (status.set(message), button.config(state="normal")))
        threading.Thread(target=work, daemon=True).start()
    button = tk.Button(root, text="Export full Word List", command=export)
    button.grid(row=5, columnspan=3, pady=12)
    root.mainloop()
