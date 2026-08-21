"""
Pure-Python ZipAligner implementation for Android APK and AAB.
Compliant with Android 4-byte and 4KB / 16KB (ARM64 page size for Android 15+) alignment rules.
Works on any architecture (x86_64, aarch64, Termux, Windows, macOS) without requiring native binaries.
"""

import io
import os
import struct
import zipfile
from pathlib import Path
from typing import Tuple, List, Dict, Optional

# PKZIP Header Signatures
SIG_LOCAL_FILE_HEADER = 0x04034B50
SIG_CENTRAL_DIRECTORY_HEADER = 0x02014B50
SIG_END_OF_CENTRAL_DIRECTORY = 0x06054B50


class ZipEntry:
    def __init__(self):
        self.version_needed = 20
        self.flags = 0
        self.compression_method = 0
        self.last_mod_time = 0
        self.last_mod_date = 0
        self.crc32 = 0
        self.compressed_size = 0
        self.uncompressed_size = 0
        self.filename = b""
        self.extra_field = b""
        self.comment = b""
        self.disk_number_start = 0
        self.internal_attributes = 0
        self.external_attributes = 0
        self.local_header_offset = 0
        self.version_made_by = 0x0314  # Unix, Zip 2.0
        self.data = b""


def align_apk(
    input_path: str,
    output_path: str,
    alignment: int = 4,
    page_align_so: bool = True,
    page_size: int = 16384
) -> bool:
    """
    Aligns a zip/apk file so uncompressed entries start at multiples of `alignment`.
    If `page_align_so` is True, uncompressed .so files are aligned to `page_size` bytes (default 16KB for Android 15+).
    """
    input_file = Path(input_path)
    output_file = Path(output_path)
    
    if not input_file.exists():
        raise FileNotFoundError(f"Input APK not found: {input_path}")

    # Read original ZIP entries using zipfile to accurately parse compressed data
    entries: List[ZipEntry] = []
    
    with zipfile.ZipFile(input_path, 'r') as zf:
        in_file = open(input_path, 'rb')
        try:
            for info in zf.infolist():
                entry = ZipEntry()
                entry.version_needed = info.extract_version
                entry.flags = info.flag_bits
                entry.compression_method = info.compress_type
                
                # Convert time tuple to DOS date/time
                dt = info.date_time
                dos_time = (dt[3] << 11) | (dt[4] << 5) | (dt[5] // 2)
                dos_date = ((max(1980, dt[0]) - 1980) << 9) | (dt[1] << 5) | dt[2]
                entry.last_mod_time = dos_time
                entry.last_mod_date = dos_date
                
                entry.crc32 = info.CRC
                entry.compressed_size = info.compress_size
                entry.uncompressed_size = info.file_size
                entry.filename = info.filename.encode('utf-8')
                entry.extra_field = info.extra
                entry.comment = info.comment
                entry.internal_attributes = info.internal_attr
                entry.external_attributes = info.external_attr
                entry.version_made_by = (info.create_system << 8) | info.create_version
                
                # Read raw compressed data directly from source file
                in_file.seek(info.header_offset)
                local_header = in_file.read(30)
                if len(local_header) < 30 or struct.unpack('<I', local_header[:4])[0] != SIG_LOCAL_FILE_HEADER:
                    raise ValueError(f"Corrupted local file header for {info.filename}")
                
                fn_len, extra_len = struct.unpack('<HH', local_header[26:30])
                in_file.seek(info.header_offset + 30 + fn_len + extra_len)
                entry.data = in_file.read(info.compress_size)
                
                entries.append(entry)
        finally:
            in_file.close()

    # Write aligned APK
    out_buf = io.BytesIO()
    
    for entry in entries:
        entry.local_header_offset = out_buf.tell()
        
        # Determine alignment requirement
        entry_align = 1
        if entry.compression_method == 0:  # STORED (uncompressed)
            if page_align_so and entry.filename.endswith(b'.so'):
                entry_align = page_size  # 16KB / 4KB alignment for native shared objects
            else:
                entry_align = alignment  # Standard 4-byte alignment
        
        # Calculate padding needed in extra field
        # Local header fixed size = 30 bytes
        current_header_size = 30 + len(entry.filename) + len(entry.extra_field)
        current_data_offset = entry.local_header_offset + current_header_size
        
        padding = 0
        if entry_align > 1:
            remainder = current_data_offset % entry_align
            if remainder != 0:
                padding = entry_align - remainder
        
        # Adjust extra field with padding
        local_extra = entry.extra_field + (b'\x00' * padding)
        
        # Write Local File Header
        out_buf.write(struct.pack(
            '<IHHHHHIIIHH',
            SIG_LOCAL_FILE_HEADER,
            entry.version_needed,
            entry.flags,
            entry.compression_method,
            entry.last_mod_time,
            entry.last_mod_date,
            entry.crc32,
            entry.compressed_size,
            entry.uncompressed_size,
            len(entry.filename),
            len(local_extra)
        ))
        out_buf.write(entry.filename)
        out_buf.write(local_extra)
        
        # Write Payload Data
        out_buf.write(entry.data)

    # Write Central Directory
    cd_start_offset = out_buf.tell()
    
    for entry in entries:
        out_buf.write(struct.pack(
            '<IHHHHHHIIIHHHHHII',
            SIG_CENTRAL_DIRECTORY_HEADER,
            entry.version_made_by,
            entry.version_needed,
            entry.flags,
            entry.compression_method,
            entry.last_mod_time,
            entry.last_mod_date,
            entry.crc32,
            entry.compressed_size,
            entry.uncompressed_size,
            len(entry.filename),
            len(entry.extra_field),
            len(entry.comment),
            0,  # disk number start
            entry.internal_attributes,
            entry.external_attributes,
            entry.local_header_offset
        ))
        out_buf.write(entry.filename)
        out_buf.write(entry.extra_field)
        out_buf.write(entry.comment)

    cd_end_offset = out_buf.tell()
    cd_size = cd_end_offset - cd_start_offset

    # Write End of Central Directory (EOCD)
    out_buf.write(struct.pack(
        '<IHHHHIIH',
        SIG_END_OF_CENTRAL_DIRECTORY,
        0,  # disk number
        0,  # disk with CD
        len(entries),  # total entries on disk
        len(entries),  # total entries in CD
        cd_size,
        cd_start_offset,
        0   # comment length
    ))

    # Write to final file
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'wb') as f:
        f.write(out_buf.getvalue())

    return True


def verify_alignment(apk_path: str, alignment: int = 4, page_size: int = 16384) -> Tuple[bool, List[str]]:
    """
    Verifies that all stored entries in an APK are properly aligned.
    Returns (is_valid, list_of_misaligned_files).
    """
    misaligned = []
    with open(apk_path, 'rb') as f:
        with zipfile.ZipFile(apk_path, 'r') as zf:
            for info in zf.infolist():
                if info.compress_type == 0:  # STORED
                    f.seek(info.header_offset)
                    header = f.read(30)
                    if len(header) < 30:
                        continue
                    fn_len, extra_len = struct.unpack('<HH', header[26:30])
                    data_offset = info.header_offset + 30 + fn_len + extra_len
                    
                    req_align = page_size if info.filename.endswith('.so') else alignment
                    if data_offset % req_align != 0:
                        misaligned.append(f"{info.filename} (offset {data_offset} not {req_align}-byte aligned)")
                        
    return (len(misaligned) == 0), misaligned
