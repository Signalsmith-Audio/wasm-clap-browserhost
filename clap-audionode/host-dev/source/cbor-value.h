/* This lets us pass complex data structues back and forth, using `CborValue *`.

The returned structures are thread-local, so they're safe as long as we're not somehow re-entrant.*/

#pragma once

#include "cbor-walker/cbor-walker.h"
#include <vector>

// CBOR-encoded blocks - thread-local, so we can send/receive them from JS
struct CborValue {
	const unsigned char *ptr;
	size_t length;
	
	signalsmith::cbor::CborWalker read() {
		return signalsmith::cbor::CborWalker(ptr, ptr + length);
	}
};

std::vector<unsigned char> & getCborVector();
CborValue * cborValue();

inline signalsmith::cbor::CborWriter getCbor() {
	auto &vector = getCborVector();
	vector.resize(0);
	return signalsmith::cbor::CborWriter(vector);
}

extern "C" {
	CborValue * resizeCbor(size_t size);
}
