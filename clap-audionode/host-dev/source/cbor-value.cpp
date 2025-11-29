#include "./cbor-value.h"

std::vector<unsigned char> & getCborVector() {
	static thread_local std::vector<unsigned char> threadVector;
	return threadVector;
}

CborValue * cborValue() {
	static thread_local CborValue c;
	auto &vector = getCborVector();
	c.ptr = vector.data();
	c.length = vector.size();
	return &c;
}

CborValue * resizeCbor(size_t size) {
	auto &vector = getCborVector();
	vector.resize(size);
	return cborValue();
}
