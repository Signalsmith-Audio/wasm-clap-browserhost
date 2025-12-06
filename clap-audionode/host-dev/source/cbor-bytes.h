/* This lets us pass complex data structues back and forth, using `CborValue *`.

The returned structures are thread-local, so they're safe as long as we're not somehow re-entrant.*/

#pragma once

#include "cbor-walker/cbor-walker.h"
#include <vector>

struct Bytes {
	std::vector<unsigned char> buffer;
	
	signalsmith::cbor::CborWalker readCbor() {
		return signalsmith::cbor::CborWalker(buffer.data(), buffer.data() + buffer.size());
	}
	
	std::string readString() const {
		return std::string{(const char *)buffer.data(), buffer.size()};
	}
	
	signalsmith::cbor::CborWriter write() {
		buffer.resize(0);
		return signalsmith::cbor::CborWriter{buffer};
	}
};

extern "C" {
	Bytes * createBytes();
	void destroyBytes(Bytes *);
	unsigned char * getBytesData(Bytes *);
	size_t getBytesLength(Bytes *);
	// For passing in bytes as an argument
	unsigned char * resizeBytes(Bytes *bytes, size_t length);
}
