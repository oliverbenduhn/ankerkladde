import os

source_file = '/home/oliver/Dokumente/ankerkladde/public/js/settings.js'

with open(source_file, 'r') as f:
    original = f.read()

# We will create modular files instead.
# Actually it is easier to write the files directly since I know exactly what logic needs to be separated.
