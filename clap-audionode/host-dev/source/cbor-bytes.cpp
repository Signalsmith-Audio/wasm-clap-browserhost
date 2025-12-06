#include "./cbor-bytes.h"

Bytes * createBytes() {
	return new Bytes();
}
void destroyBytes(Bytes *bytes) {
	delete bytes;
}
unsigned char * getBytesData(Bytes *bytes) {
	return bytes->buffer.data();
}
size_t getBytesLength(Bytes *bytes) {
	return bytes->buffer.size();
}
unsigned char * resizeBytes(Bytes *bytes, size_t length) {
	bytes->buffer.resize(length);
	return bytes->buffer.data();
}
