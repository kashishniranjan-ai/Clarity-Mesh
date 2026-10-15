import ast
p = "C:\\Users\\Kashish Niranjan\\Clarity-Mesh\\backend\\services\\model_registry.py"
src = open(p).read()
try:
    ast.parse(src)
    print("SYNTAX_OK")
except SyntaxError as e:
    print(f"ERROR line {e.lineno}: {e.msg}")
    lines = src.splitlines()
    for i in range(e.lineno-2, e.lineno+2):
        print(f"{i+1}: {lines[i]!r}")
